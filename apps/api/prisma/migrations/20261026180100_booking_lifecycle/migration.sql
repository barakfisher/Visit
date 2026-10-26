BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "Booking" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "Booking" ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "BookingEvent" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "businessId" TEXT NOT NULL, "bookingId" TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BASELINE','CREATED','RESCHEDULED','CANCELLED','COMPLETED','NO_SHOW')),
  "actorIdentityId" TEXT, source TEXT NOT NULL CHECK (source IN ('CUSTOMER','PROVIDER','SYSTEM')),
  reason TEXT NOT NULL CHECK (reason IN ('LEGACY_BASELINE','FINAL_CONSENT','CUSTOMER_REQUEST','PROVIDER_REQUEST','APPOINTMENT_FINISHED','CUSTOMER_ABSENT','SYSTEM_CHANGE')),
  "oldStatus" "BookingStatus", "newStatus" "BookingStatus" NOT NULL,
  "oldStartsAt" TIMESTAMP(3), "oldEndsAt" TIMESTAMP(3),
  "newStartsAt" TIMESTAMP(3) NOT NULL, "newEndsAt" TIMESTAMP(3) NOT NULL,
  "oldStaffId" TEXT, "newStaffId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId", "bookingId") REFERENCES "Booking"("businessId", id) ON DELETE CASCADE ON UPDATE RESTRICT,
  UNIQUE ("businessId", "bookingId", revision)
);
CREATE INDEX "BookingEvent_businessId_bookingId_createdAt_idx" ON "BookingEvent"("businessId","bookingId","createdAt");
-- Historical mutation actors and confirmation dates are unknown. Do not invent them.
INSERT INTO "BookingEvent" ("businessId","bookingId",revision,kind,source,reason,"newStatus","newStartsAt","newEndsAt","newStaffId")
SELECT "businessId",id,revision,'BASELINE','SYSTEM','LEGACY_BASELINE',status,"startsAt","endsAt","staffId"
FROM "Booking" WHERE status IN ('CONFIRMED','COMPLETED','NO_SHOW','CANCELLED');

CREATE FUNCTION visit_booking_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.revision := 0; RETURN NEW; END IF;
  IF NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
    RAISE EXCEPTION 'VISIT_BOOKING_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'HELD' AND NEW.status IN ('CONFIRMED','CANCELLED','EXPIRED')) OR
    (OLD.status = 'CONFIRMED' AND NEW.status IN ('CANCELLED','COMPLETED','NO_SHOW'))
  ) THEN RAISE EXCEPTION 'VISIT_BOOKING_INVALID_TRANSITION' USING ERRCODE = '23514'; END IF;
  IF OLD.status IN ('CANCELLED','EXPIRED','COMPLETED','NO_SHOW') AND
    (NEW."startsAt",NEW."endsAt",NEW."staffId",NEW."occupiedFrom",NEW."occupiedUntil") IS DISTINCT FROM
    (OLD."startsAt",OLD."endsAt",OLD."staffId",OLD."occupiedFrom",OLD."occupiedUntil") THEN
    RAISE EXCEPTION 'VISIT_BOOKING_TERMINAL_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('COMPLETED','NO_SHOW') AND OLD.status <> NEW.status AND NEW."endsAt" > (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'VISIT_BOOKING_NOT_FINISHED' USING ERRCODE = '23514';
  END IF;
  NEW.revision := OLD.revision + CASE WHEN
    (NEW.status,NEW."startsAt",NEW."endsAt",NEW."staffId") IS DISTINCT FROM
    (OLD.status,OLD."startsAt",OLD."endsAt",OLD."staffId") THEN 1 ELSE 0 END;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_lifecycle_guard BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION visit_booking_lifecycle_guard();
CREATE FUNCTION visit_booking_lifecycle_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind TEXT; actor_id TEXT; event_source TEXT; event_reason TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'CONFIRMED' THEN RETURN NEW; END IF;
    event_kind := 'CREATED';
  ELSE
    IF NEW.revision = OLD.revision THEN RETURN NEW; END IF;
    IF OLD.status = 'HELD' AND NEW.status = 'CONFIRMED' THEN event_kind := 'CREATED';
    ELSIF OLD.status <> 'CONFIRMED' THEN RETURN NEW;
    ELSIF NEW.status <> OLD.status THEN event_kind := NEW.status::text;
    ELSE event_kind := 'RESCHEDULED'; END IF;
  END IF;
  actor_id := nullif(current_setting('visit.booking_actor', true), '');
  event_source := coalesce(nullif(current_setting('visit.booking_source', true), ''), 'SYSTEM');
  event_reason := coalesce(nullif(current_setting('visit.booking_reason', true), ''), 'SYSTEM_CHANGE');
  INSERT INTO "BookingEvent" ("businessId","bookingId",revision,kind,"actorIdentityId",source,reason,"oldStatus","newStatus","oldStartsAt","oldEndsAt","newStartsAt","newEndsAt","oldStaffId","newStaffId")
  VALUES (NEW."businessId",NEW.id,NEW.revision,event_kind,actor_id,event_source,event_reason,
    CASE WHEN TG_OP = 'UPDATE' AND event_kind <> 'CREATED' THEN OLD.status END, NEW.status,
    CASE WHEN TG_OP = 'UPDATE' AND event_kind <> 'CREATED' THEN OLD."startsAt" END,
    CASE WHEN TG_OP = 'UPDATE' AND event_kind <> 'CREATED' THEN OLD."endsAt" END,
    NEW."startsAt",NEW."endsAt",
    CASE WHEN TG_OP = 'UPDATE' AND event_kind <> 'CREATED' THEN OLD."staffId" END, NEW."staffId");
  RETURN NEW;
END $$;
CREATE TRIGGER booking_lifecycle_event AFTER INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION visit_booking_lifecycle_event();
CREATE FUNCTION visit_booking_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- Parent deletion is the documented privileged retention/purge exception, never a customer API.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'VISIT_BOOKING_EVENT_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER booking_event_immutable BEFORE INSERT OR UPDATE OR DELETE ON "BookingEvent" FOR EACH ROW EXECUTE FUNCTION visit_booking_event_immutable();
CREATE OR REPLACE FUNCTION visit_resource_peak(
  p_business text, p_staff text, p_exclude text DEFAULT NULL,
  p_from timestamp DEFAULT NULL, p_until timestamp DEFAULT NULL,
  p_add boolean DEFAULT false
) RETURNS integer LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  WITH intervals AS (
    SELECT "occupiedFrom" AS starts, "occupiedUntil" AS ends
    FROM "Booking"
    WHERE "businessId" = p_business AND "staffId" = p_staff
      AND (p_exclude IS NULL OR id <> p_exclude)
      AND ("status" IN ('CONFIRMED','COMPLETED','NO_SHOW') OR ("status" = 'HELD' AND "holdExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')))
      AND (p_from IS NULL OR "occupiedUntil" > p_from)
      AND (p_until IS NULL OR "occupiedFrom" < p_until)
    UNION ALL SELECT p_from, p_until WHERE p_add
  ), events AS (
    SELECT starts AS at, 1 AS delta FROM intervals
    UNION ALL SELECT ends AS at, -1 AS delta FROM intervals
  ), running AS (
    SELECT sum(delta) OVER (ORDER BY at, delta ROWS UNBOUNDED PRECEDING) AS count FROM events
  ) SELECT coalesce(max(count), 0)::integer FROM running;
$$;

CREATE OR REPLACE FUNCTION visit_guard_booking_capacity() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE resource record; allowed integer;
BEGIN
  -- Canonical resource order prevents opposite staff moves taking reverse locks.
  -- The no-op write is intentional: stale RR/Serializable snapshots must retry.
  FOR resource IN
    SELECT DISTINCT business_id, staff_id FROM (
      SELECT NEW."businessId" AS business_id, NEW."staffId" AS staff_id WHERE TG_OP <> 'DELETE'
      UNION ALL SELECT OLD."businessId", OLD."staffId" WHERE TG_OP <> 'INSERT'
    ) resources ORDER BY business_id, staff_id
  LOOP
    UPDATE "Staff" s SET "parallelCapacity" = s."parallelCapacity"
      WHERE s."businessId" = resource.business_id AND s.id = resource.staff_id;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."status" NOT IN ('CONFIRMED','COMPLETED','NO_SHOW') AND NOT (NEW."status" = 'HELD' AND NEW."holdExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')) THEN RETURN NEW; END IF;
  SELECT "parallelCapacity" INTO allowed FROM "Staff" WHERE "businessId" = NEW."businessId" AND id = NEW."staffId";
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF visit_resource_peak(NEW."businessId", NEW."staffId", NEW.id, NEW."occupiedFrom", NEW."occupiedUntil", true) > allowed THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'VISIT_BOOKING_CAPACITY', CONSTRAINT = 'visit_booking_capacity';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
