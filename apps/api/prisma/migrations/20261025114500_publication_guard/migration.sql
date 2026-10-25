-- Existing businesses remain unpublished. No confirmed appointment is changed.
-- New holds/new confirmed appointments and hold confirmation must serialize with
-- unpublish. Owned rescheduling/cancellation of existing confirmed records stays allowed.
CREATE FUNCTION visit_guard_booking_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status IN ('HELD', 'CONFIRMED')) OR
     (TG_OP = 'UPDATE' AND OLD.status = 'HELD' AND NEW.status = 'CONFIRMED') THEN
    PERFORM id FROM "Business" WHERE id = NEW."businessId" AND "approvalStatus" = 'APPROVED' AND "publishedAt" IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_BUSINESS_UNPUBLISHED' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_publication_guard BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION visit_guard_booking_publication();
