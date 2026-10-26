ALTER TABLE "Identity" ADD COLUMN "displayName" TEXT CHECK ("displayName" IS NULL OR length(btrim("displayName")) BETWEEN 2 AND 120);
ALTER TABLE "BookingPolicy" ADD COLUMN "requireCustomerName" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireVerifiedPhone" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "requireVerifiedEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "customerName" TEXT, ADD COLUMN "customerPhone" TEXT, ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "customerPhoneVerifiedAt" TIMESTAMPTZ(3), ADD COLUMN "customerEmailVerifiedAt" TIMESTAMPTZ(3), ADD COLUMN "customerContactCapturedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "Booking_contact_proof_pairs" CHECK (("customerPhone" IS NULL) = ("customerPhoneVerifiedAt" IS NULL) AND ("customerEmail" IS NULL) = ("customerEmailVerifiedAt" IS NULL));
-- Do not backfill historical verification or contact snapshots from today's identity.
CREATE FUNCTION visit_booking_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person "Identity"%ROWTYPE; policy "BookingPolicy"%ROWTYPE;
BEGIN
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
CREATE TRIGGER booking_contact_guard BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION visit_booking_contact_guard();
