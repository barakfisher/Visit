-- Prevent raw expired/cancelled record reactivation from bypassing publication.
CREATE OR REPLACE FUNCTION visit_guard_booking_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('HELD', 'CONFIRMED') AND
     (TG_OP = 'INSERT' OR NEW.status = 'HELD' OR OLD.status <> 'CONFIRMED' OR OLD."businessId" IS DISTINCT FROM NEW."businessId") THEN
    PERFORM id FROM "Business" WHERE id = NEW."businessId" AND "approvalStatus" = 'APPROVED' AND "publishedAt" IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_BUSINESS_UNPUBLISHED' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
