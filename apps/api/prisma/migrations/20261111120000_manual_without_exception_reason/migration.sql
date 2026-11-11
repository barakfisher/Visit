BEGIN;
SET LOCAL lock_timeout = '5s';
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
    PERFORM id FROM "Membership" WHERE "businessId" = NEW."businessId" AND "identityId" = NEW."enteredByIdentityId" AND status = 'ACTIVE' AND role IN ('OWNER','MANAGER') FOR SHARE;
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

COMMIT;
