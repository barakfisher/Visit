-- Worker access slice 4: a booking, move or cancellation on a linked staff row also notifies that row's worker
-- (worker-access.md, Build plan item 4; decisions.md, "Worker notifications"). Only the third insert is new.
BEGIN;
SET LOCAL lock_timeout = '5s';
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
    WHERE m."businessId" = NEW."businessId" AND m.status = 'ACTIVE' AND m.role IN ('OWNER','MANAGER')
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
