BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE "BookingReschedule" (
 id TEXT PRIMARY KEY, "bookingId" TEXT NOT NULL REFERENCES "Booking"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
 "idempotencyKey" TEXT NOT NULL, fingerprint TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("bookingId", "idempotencyKey")
);
ALTER TABLE "BookingNotification" DROP CONSTRAINT "BookingNotification_businessId_bookingId_key";
CREATE INDEX "BookingNotification_businessId_bookingId_idx" ON "BookingNotification"("businessId", "bookingId");
ALTER TABLE "BookingNotification" DROP CONSTRAINT "BookingNotification_kind_check";
ALTER TABLE "BookingNotification" ADD CONSTRAINT "BookingNotification_kind_check" CHECK (kind IN ('BOOKING_CONFIRMED','BOOKING_RESCHEDULED','BOOKING_CANCELLED'));
CREATE OR REPLACE FUNCTION visit_record_booking_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE notification_kind TEXT;
BEGIN
 notification_kind := CASE WHEN NEW.kind = 'CREATED' AND NEW."newStatus" = 'CONFIRMED' THEN 'BOOKING_CONFIRMED'
   WHEN NEW.kind = 'RESCHEDULED' THEN 'BOOKING_RESCHEDULED'
   WHEN NEW.kind = 'CANCELLED' THEN 'BOOKING_CANCELLED' END;
 IF notification_kind IS NOT NULL THEN
  INSERT INTO "BookingNotification" ("businessId","bookingId","eventId",kind,"createdAt")
   VALUES (NEW."businessId",NEW."bookingId",NEW.id,notification_kind,NEW."createdAt") ON CONFLICT ("eventId") DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
