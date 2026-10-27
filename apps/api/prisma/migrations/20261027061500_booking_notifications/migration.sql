BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "BookingEvent" IN SHARE ROW EXCLUSIVE MODE;
CREATE UNIQUE INDEX "BookingEvent_businessId_bookingId_id_key" ON "BookingEvent"("businessId","bookingId",id);
CREATE TABLE "BookingNotification" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "businessId" TEXT NOT NULL, "bookingId" TEXT NOT NULL, "eventId" TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL DEFAULT 'BOOKING_CONFIRMED' CHECK (kind = 'BOOKING_CONFIRMED'),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("businessId","bookingId","eventId") REFERENCES "BookingEvent"("businessId","bookingId",id) ON DELETE CASCADE ON UPDATE RESTRICT,
 UNIQUE ("businessId","bookingId")
);
-- Only known committed creation events qualify; do not invent legacy notifications.
INSERT INTO "BookingNotification" ("businessId","bookingId","eventId","createdAt")
 SELECT "businessId","bookingId",id,"createdAt" FROM "BookingEvent" WHERE kind = 'CREATED' AND "newStatus" = 'CONFIRMED'
 ON CONFLICT ("businessId","bookingId") DO NOTHING;
CREATE FUNCTION visit_record_booking_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind = 'CREATED' AND NEW."newStatus" = 'CONFIRMED' THEN
  INSERT INTO "BookingNotification" ("businessId","bookingId","eventId","createdAt")
   VALUES (NEW."businessId",NEW."bookingId",NEW.id,NEW."createdAt") ON CONFLICT ("businessId","bookingId") DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_notification_record AFTER INSERT ON "BookingEvent" FOR EACH ROW EXECUTE FUNCTION visit_record_booking_notification();
CREATE FUNCTION visit_booking_notification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
 IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'VISIT_BOOKING_NOTIFICATION_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER booking_notification_immutable BEFORE INSERT OR UPDATE OR DELETE ON "BookingNotification" FOR EACH ROW EXECUTE FUNCTION visit_booking_notification_immutable();
COMMIT;
