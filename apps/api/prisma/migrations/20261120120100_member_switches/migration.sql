-- Worker access slice 5: four stored switches per member replace the role table (worker-access.md, Privileges and
-- Build plan item 5; decisions.md, "Switches"). Every MANAGER becomes a member with all four on, every STAFF a member
-- with all four off, so no one's access changes on the day (test/member-switches-migration.test.ts).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- One membership per person per business. Measured before this migration: nobody held two. Rather than guess how to
-- merge two rows (which status, which calendar, which switches), the migration stops and names the problem.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Membership" GROUP BY "identityId", "businessId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'VISIT_MEMBERSHIP_DUPLICATES: a person holds several memberships in one business; merge them before this migration';
  END IF;
END $$;

ALTER TABLE "Membership"
  ADD COLUMN "seeAllCalendars" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "actOnAllCalendars" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "businessSetup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manageTeam" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Membership" SET role = 'MEMBER', "seeAllCalendars" = true, "actOnAllCalendars" = true, "businessSetup" = true, "manageTeam" = true WHERE role = 'MANAGER';
UPDATE "Membership" SET role = 'MEMBER' WHERE role = 'STAFF';
UPDATE "Membership" SET "seeAllCalendars" = true, "actOnAllCalendars" = true, "businessSetup" = true, "manageTeam" = true WHERE role = 'OWNER';

-- The owner is always everything: any write of an owner row turns all four on, and the check refuses anything else.
CREATE FUNCTION visit_membership_owner_switches() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role = 'OWNER' THEN
    NEW."seeAllCalendars" := true; NEW."actOnAllCalendars" := true; NEW."businessSetup" := true; NEW."manageTeam" := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_owner_switches BEFORE INSERT OR UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION visit_membership_owner_switches();

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_role_check" CHECK (role IN ('OWNER', 'MEMBER')),
  ADD CONSTRAINT "Membership_owner_switches_check" CHECK (role <> 'OWNER' OR ("seeAllCalendars" AND "actOnAllCalendars" AND "businessSetup" AND "manageTeam")),
  -- Acting on a calendar you cannot see has no screen and no use (the user's call).
  ADD CONSTRAINT "Membership_act_needs_see_check" CHECK (NOT "actOnAllCalendars" OR "seeAllCalendars");

DROP INDEX "Membership_identityId_businessId_role_key";
CREATE UNIQUE INDEX "Membership_identityId_businessId_key" ON "Membership"("identityId", "businessId");

-- An invitation still names a preset (MANAGER or STAFF). A member may only invite the Worker preset: a member never
-- holds strictly more than all four switches. Accepted invitations keep the inviter role they were made with.
ALTER TABLE "BusinessInvitation" DROP CONSTRAINT "BusinessInvitation_check";
ALTER TABLE "BusinessInvitation" ADD CONSTRAINT "BusinessInvitation_check" CHECK (role IN ('MANAGER', 'STAFF')
  AND ("inviterRole" = 'OWNER' OR ("inviterRole" IN ('MANAGER', 'MEMBER') AND role = 'STAFF')));

-- The owner changing a member's switches is audited, with the values set.
ALTER TABLE "BusinessAccessEvent" ADD COLUMN "switches" JSONB;
ALTER TABLE "BusinessAccessEvent" DROP CONSTRAINT "BusinessAccessEvent_action_check";
ALTER TABLE "BusinessAccessEvent" ADD CONSTRAINT "BusinessAccessEvent_action_check" CHECK (action IN ('JOINED', 'REVOKED', 'OWNER_GRANTED', 'SWITCHES_CHANGED'));

-- The two booking triggers read the switches instead of roles. Each is a copy of its previous version
-- (20261119120000_worker_own_calendar_manual, 20261119180000_worker_notifications) with only the membership check changed.
CREATE OR REPLACE FUNCTION visit_booking_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person "Identity"%ROWTYPE; policy "BookingPolicy"%ROWTYPE;
BEGIN

  IF NEW.source = 'MANUAL' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.source <> 'MANUAL' OR (NEW."customerId",NEW."customerName",NEW."customerPhone",NEW."customerEmail",NEW."customerPhoneVerifiedAt",NEW."customerEmailVerifiedAt",NEW."customerContactCapturedAt",NEW."enteredByIdentityId",NEW."manualReason",NEW."manualFingerprint") IS DISTINCT FROM
        (OLD."customerId",OLD."customerName",OLD."customerPhone",OLD."customerEmail",OLD."customerPhoneVerifiedAt",OLD."customerEmailVerifiedAt",OLD."customerContactCapturedAt",OLD."enteredByIdentityId",OLD."manualReason",OLD."manualFingerprint") THEN
        RAISE EXCEPTION 'VISIT_CONTACT_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status <> 'CONFIRMED' OR NEW."enteredByIdentityId" IS DISTINCT FROM nullif(current_setting('visit.booking_actor',true),'')
      OR current_setting('visit.booking_source',true) IS DISTINCT FROM 'MANUAL' THEN
      RAISE EXCEPTION 'VISIT_MANUAL_BOOKING_AUTHORIZATION' USING ERRCODE = '23514';
    END IF;
    PERFORM id FROM "Session" WHERE id = nullif(current_setting('visit.booking_session',true),'') AND "identityId" = NEW."enteredByIdentityId" AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_MANUAL_BOOKING_AUTHORIZATION' USING ERRCODE = '23514'; END IF;
    -- The owner and a member who may act on other calendars book on any row; any other member only on the live
    -- staff row their membership is linked to (decisions.md, "My day for a worker" and "Switches").
    PERFORM m.id FROM "Membership" m WHERE m."businessId" = NEW."businessId" AND m."identityId" = NEW."enteredByIdentityId" AND m.status = 'ACTIVE'
      AND (m.role = 'OWNER' OR m."actOnAllCalendars" OR (m."staffId" = NEW."staffId"
        AND EXISTS (SELECT 1 FROM "Staff" s WHERE s."businessId" = m."businessId" AND s.id = m."staffId" AND s."archivedAt" IS NULL)))
      FOR SHARE OF m;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_MANUAL_BOOKING_AUTHORIZATION' USING ERRCODE = '23514'; END IF;
    SELECT * INTO policy FROM "BookingPolicy" WHERE "businessId" = NEW."businessId" FOR SHARE;
    -- A manual appointment no longer needs a written reason under a verified-contact policy (decisions.md, 2026-11-11).
    -- The audit reason below still records that the policy was in force; an old reason, when present, keeps the column's length check.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VISIT_CUSTOMER_CONTACT_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF current_setting('visit.booking_reason',true) IS DISTINCT FROM (CASE WHEN policy."requireVerifiedPhone" OR policy."requireVerifiedEmail" THEN 'MANUAL_CONTACT_EXCEPTION' ELSE 'MANUAL_ENTRY' END) THEN
      RAISE EXCEPTION 'VISIT_MANUAL_BOOKING_AUTHORIZATION' USING ERRCODE = '23514';
    END IF;
    NEW."customerContactCapturedAt" := clock_timestamp();
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.source = 'MANUAL' THEN RAISE EXCEPTION 'VISIT_CONTACT_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN RAISE EXCEPTION 'VISIT_CONTACT_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514'; END IF;
    IF OLD."customerContactCapturedAt" IS NOT NULL THEN
      IF NEW."customerName" IS DISTINCT FROM OLD."customerName" OR NEW."customerPhone" IS DISTINCT FROM OLD."customerPhone"
        OR NEW."customerEmail" IS DISTINCT FROM OLD."customerEmail" OR NEW."customerPhoneVerifiedAt" IS DISTINCT FROM OLD."customerPhoneVerifiedAt"
        OR NEW."customerEmailVerifiedAt" IS DISTINCT FROM OLD."customerEmailVerifiedAt" OR NEW."customerContactCapturedAt" IS DISTINCT FROM OLD."customerContactCapturedAt"
        OR (OLD.status <> 'CONFIRMED' AND NEW.status = 'CONFIRMED') THEN
        RAISE EXCEPTION 'VISIT_CONTACT_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Existing confirmed appointments retain their historical (possibly absent) snapshot.
    IF OLD.status = 'CONFIRMED' THEN
      IF NEW."customerName" IS DISTINCT FROM OLD."customerName" OR NEW."customerPhone" IS DISTINCT FROM OLD."customerPhone"
        OR NEW."customerEmail" IS DISTINCT FROM OLD."customerEmail" OR NEW."customerPhoneVerifiedAt" IS DISTINCT FROM OLD."customerPhoneVerifiedAt"
        OR NEW."customerEmailVerifiedAt" IS DISTINCT FROM OLD."customerEmailVerifiedAt" OR NEW."customerContactCapturedAt" IS DISTINCT FROM OLD."customerContactCapturedAt" THEN
        RAISE EXCEPTION 'VISIT_CONTACT_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.status IN ('HELD', 'CONFIRMED') THEN
    PERFORM id FROM "Business" WHERE id = NEW."businessId" FOR SHARE;
    SELECT * INTO person FROM "Identity" WHERE id = NEW."customerId" FOR SHARE;
    SELECT * INTO policy FROM "BookingPolicy" WHERE "businessId" = NEW."businessId" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_CUSTOMER_CONTACT_REQUIRED' USING ERRCODE = '23514'; END IF;
    IF (policy."requireCustomerName" AND (person."displayName" IS NULL OR length(btrim(person."displayName")) < 2))
      OR (policy."requireVerifiedPhone" AND (person.phone IS NULL OR person."phoneVerifiedAt" IS NULL))
      OR (policy."requireVerifiedEmail" AND (person.email IS NULL OR person."emailVerifiedAt" IS NULL)) THEN
      RAISE EXCEPTION 'VISIT_CUSTOMER_CONTACT_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CONFIRMED' THEN
      NEW."customerName" := person."displayName";
      NEW."customerPhone" := CASE WHEN person."phoneVerifiedAt" IS NOT NULL THEN person.phone ELSE NULL END;
      NEW."customerEmail" := CASE WHEN person."emailVerifiedAt" IS NOT NULL THEN person.email ELSE NULL END;
      NEW."customerPhoneVerifiedAt" := CASE WHEN person.phone IS NOT NULL THEN person."phoneVerifiedAt" ELSE NULL END;
      NEW."customerEmailVerifiedAt" := CASE WHEN person.email IS NOT NULL THEN person."emailVerifiedAt" ELSE NULL END;
      NEW."customerContactCapturedAt" := clock_timestamp();
      RETURN NEW;
    END IF;
  END IF;
  NEW."customerName" := NULL; NEW."customerPhone" := NULL; NEW."customerEmail" := NULL;
  NEW."customerPhoneVerifiedAt" := NULL; NEW."customerEmailVerifiedAt" := NULL; NEW."customerContactCapturedAt" := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION visit_notify_booking_event() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE notification_kind TEXT; booking_customer TEXT;
BEGIN
  notification_kind := CASE
    WHEN NEW.kind = 'CREATED' AND NEW."newStatus" = 'CONFIRMED' THEN 'BOOKING_CONFIRMED'
    WHEN NEW.kind = 'RESCHEDULED' THEN 'BOOKING_RESCHEDULED'
    WHEN NEW.kind = 'CANCELLED' THEN 'BOOKING_CANCELLED'
    WHEN NEW.kind = 'COMPLETED' THEN 'BOOKING_COMPLETED'
    WHEN NEW.kind = 'NO_SHOW' THEN 'BOOKING_NO_SHOW'
  END;
  IF notification_kind IS NULL THEN RETURN NEW; END IF;
  SELECT "customerId" INTO booking_customer FROM "Booking" WHERE id = NEW."bookingId" AND "businessId" = NEW."businessId";
  INSERT INTO "Notification" ("identityId","businessId","kind","audience","bookingId","eventId","createdAt")
    SELECT booking_customer, NEW."businessId", notification_kind, 'CUSTOMER', NEW."bookingId", NEW.id, NEW."createdAt"
    WHERE booking_customer IS NOT NULL AND booking_customer IS DISTINCT FROM NEW."actorIdentityId"
    ON CONFLICT ("identityId","eventId") DO NOTHING;
  INSERT INTO "Notification" ("identityId","businessId","kind","audience","bookingId","eventId","createdAt")
    SELECT DISTINCT m."identityId", NEW."businessId", notification_kind, 'BUSINESS', NEW."bookingId", NEW.id, NEW."createdAt"
    FROM "Membership" m
    WHERE m."businessId" = NEW."businessId" AND m.status = 'ACTIVE' AND (m.role = 'OWNER' OR m."seeAllCalendars")
      AND m."identityId" IS DISTINCT FROM NEW."actorIdentityId"
    ON CONFLICT ("identityId","eventId") DO NOTHING;
  -- The worker of the row the booking was on and the row it is on now, so a move between rows tells both.
  -- Booking, move and cancellation only; outcomes are the worker's own to mark. A person already notified above,
  -- as the customer or as an owner or manager, keeps that one row (the unique index). An archived row has no worker.
  IF notification_kind IN ('BOOKING_CONFIRMED','BOOKING_RESCHEDULED','BOOKING_CANCELLED') THEN
    INSERT INTO "Notification" ("identityId","businessId","kind","audience","bookingId","eventId","createdAt")
      SELECT DISTINCT m."identityId", NEW."businessId", notification_kind, 'BUSINESS', NEW."bookingId", NEW.id, NEW."createdAt"
      FROM "Membership" m JOIN "Staff" s ON s."businessId" = m."businessId" AND s.id = m."staffId"
      WHERE m."businessId" = NEW."businessId" AND m.status = 'ACTIVE' AND s."archivedAt" IS NULL
        AND m."staffId" IN (NEW."newStaffId", NEW."oldStaffId")
        AND m."identityId" IS DISTINCT FROM NEW."actorIdentityId"
      ON CONFLICT ("identityId","eventId") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
