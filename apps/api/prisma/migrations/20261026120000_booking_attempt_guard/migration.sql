-- Terminal intent fences late workers even after their orchestration connection is lost.
CREATE FUNCTION visit_booking_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent "BookingAttempt"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'CONFIRMED' THEN RETURN NEW; END IF;
  END IF;
  IF NEW.status IN ('HELD', 'CONFIRMED') THEN
    SELECT * INTO intent FROM "BookingAttempt" WHERE "businessId" = NEW."businessId" AND "idempotencyKey" = NEW."idempotencyKey" FOR SHARE;
    IF FOUND AND (intent.status = 'REJECTED' OR intent."customerId" IS DISTINCT FROM NEW."customerId") THEN
      RAISE EXCEPTION 'VISIT_ATTEMPT_REJECTED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_attempt_guard BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION visit_booking_attempt_guard();
