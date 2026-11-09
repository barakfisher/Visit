BEGIN;
-- Adding foreign keys locks Identity, Business and BookingEvent: fail fast rather than queue bookings behind a slow reader.
SET LOCAL lock_timeout = '5s';
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "identityId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "bookingId" TEXT,
  "eventId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMPTZ(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_audience_check" CHECK ("audience" IN ('CUSTOMER','BUSINESS')),
  -- A booking notification always points at its event; a system message never does.
  CONSTRAINT "Notification_kind_check" CHECK (
    ("kind" IN ('BOOKING_CONFIRMED','BOOKING_RESCHEDULED','BOOKING_CANCELLED','BOOKING_COMPLETED','BOOKING_NO_SHOW') AND "bookingId" IS NOT NULL AND "eventId" IS NOT NULL)
    OR ("kind" IN ('BUSINESS_APPROVED','BUSINESS_REJECTED') AND "bookingId" IS NULL AND "eventId" IS NULL)
  )
);
CREATE UNIQUE INDEX "Notification_identityId_eventId_key" ON "Notification"("identityId", "eventId");
CREATE INDEX "Notification_identityId_createdAt_id_idx" ON "Notification"("identityId", "createdAt" DESC, "id" DESC);
CREATE INDEX "Notification_identityId_readAt_idx" ON "Notification"("identityId", "readAt");
CREATE INDEX "Notification_businessId_bookingId_eventId_idx" ON "Notification"("businessId", "bookingId", "eventId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_bookingId_eventId_fkey" FOREIGN KEY ("businessId", "bookingId", "eventId") REFERENCES "BookingEvent"("businessId", "bookingId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Runs in the booking's own transaction, so a change and its notifications commit together and no call site can forget.
-- HELD and EXPIRED never get here as a notified kind: they are internal steps of booking.
-- The customer comes first, so a manager who is also this booking's customer gets one row, as the customer.
CREATE FUNCTION visit_notify_booking_event() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
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
  RETURN NEW;
END $$;
CREATE TRIGGER booking_event_notify AFTER INSERT ON "BookingEvent" FOR EACH ROW EXECUTE FUNCTION visit_notify_booking_event();

-- The Home card this replaces was shown to whoever manages an approved, unpublished business.
-- Without this row they would lose the reminder on the day it is removed. Past bookings are deliberately not backfilled.
INSERT INTO "Notification" ("identityId","businessId","kind","audience")
  SELECT DISTINCT m."identityId", m."businessId", 'BUSINESS_APPROVED', 'BUSINESS'
  FROM "Membership" m JOIN "Business" b ON b.id = m."businessId"
  WHERE m.status = 'ACTIVE' AND m.role IN ('OWNER','MANAGER')
    AND b."approvalStatus" = 'APPROVED' AND b."publishedAt" IS NULL AND b."deletedAt" IS NULL;
COMMIT;
