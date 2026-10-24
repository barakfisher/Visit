BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "Booking", "Staff" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Staff" ADD CONSTRAINT "Staff_positive_capacity" CHECK ("parallelCapacity" > 0);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_valid_occupied_interval"
  CHECK ("startsAt" < "endsAt" AND "occupiedFrom" <= "startsAt" AND "occupiedUntil" >= "endsAt");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_held_requires_expiry"
  CHECK ("status" <> 'HELD' OR "holdExpiresAt" IS NOT NULL);

CREATE FUNCTION visit_resource_peak(
  p_business text, p_staff text, p_exclude text DEFAULT NULL,
  p_from timestamp DEFAULT NULL, p_until timestamp DEFAULT NULL,
  p_add boolean DEFAULT false
) RETURNS integer LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  WITH intervals AS (
    SELECT "occupiedFrom" AS starts, "occupiedUntil" AS ends
    FROM "Booking"
    WHERE "businessId" = p_business AND "staffId" = p_staff
      AND (p_exclude IS NULL OR id <> p_exclude)
      AND ("status" = 'CONFIRMED' OR ("status" = 'HELD' AND "holdExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')))
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

-- Refuse migration over invalid active data; never delete or rewrite bookings.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Staff" s WHERE visit_resource_peak(s."businessId", s.id) > s."parallelCapacity") THEN
    RAISE EXCEPTION 'VISIT_EXISTING_OVER_CAPACITY: reconcile active bookings before applying this migration';
  END IF;
END $$;

CREATE FUNCTION visit_guard_booking_capacity() RETURNS trigger
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
  IF NEW."status" <> 'CONFIRMED' AND NOT (NEW."status" = 'HELD' AND NEW."holdExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')) THEN RETURN NEW; END IF;
  SELECT "parallelCapacity" INTO allowed FROM "Staff" WHERE "businessId" = NEW."businessId" AND id = NEW."staffId";
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF visit_resource_peak(NEW."businessId", NEW."staffId", NEW.id, NEW."occupiedFrom", NEW."occupiedUntil", true) > allowed THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'VISIT_BOOKING_CAPACITY', CONSTRAINT = 'visit_booking_capacity';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER visit_booking_capacity
BEFORE INSERT OR UPDATE OR DELETE ON "Booking"
FOR EACH ROW EXECUTE FUNCTION visit_guard_booking_capacity();

CREATE FUNCTION visit_guard_staff_capacity() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
BEGIN
  IF visit_resource_peak(NEW."businessId", NEW.id) > NEW."parallelCapacity" THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'VISIT_BOOKING_CAPACITY', CONSTRAINT = 'visit_staff_capacity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_staff_capacity
BEFORE UPDATE OF "parallelCapacity" ON "Staff"
FOR EACH ROW WHEN (OLD."parallelCapacity" IS DISTINCT FROM NEW."parallelCapacity")
EXECUTE FUNCTION visit_guard_staff_capacity();
COMMIT;
