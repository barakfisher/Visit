-- A customer's inbox is the record of their appointments, so it includes the changes they made themselves.
-- A manager still gets nothing for their own action: the row would only repeat what they just did to someone else's booking.
-- Past bookings are deliberately not backfilled.
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
    WHERE booking_customer IS NOT NULL
    ON CONFLICT ("identityId","eventId") DO NOTHING;
  INSERT INTO "Notification" ("identityId","businessId","kind","audience","bookingId","eventId","createdAt")
    SELECT DISTINCT m."identityId", NEW."businessId", notification_kind, 'BUSINESS', NEW."bookingId", NEW.id, NEW."createdAt"
    FROM "Membership" m
    WHERE m."businessId" = NEW."businessId" AND m.status = 'ACTIVE' AND m.role IN ('OWNER','MANAGER')
      AND m."identityId" IS DISTINCT FROM NEW."actorIdentityId"
    ON CONFLICT ("identityId","eventId") DO NOTHING;
  RETURN NEW;
END $$;
