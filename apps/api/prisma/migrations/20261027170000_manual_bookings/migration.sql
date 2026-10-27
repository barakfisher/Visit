BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Booking" ALTER COLUMN "customerId" DROP NOT NULL,
 ADD COLUMN source TEXT NOT NULL DEFAULT 'CUSTOMER',
 ADD COLUMN "enteredByIdentityId" TEXT REFERENCES "Identity"(id) ON DELETE RESTRICT,
 ADD COLUMN "manualReason" TEXT,
 ADD COLUMN "manualFingerprint" TEXT,
 DROP CONSTRAINT "Booking_contact_proof_pairs";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customer_source" CHECK (
 (source = 'CUSTOMER' AND "customerId" IS NOT NULL AND "enteredByIdentityId" IS NULL AND "manualReason" IS NULL AND "manualFingerprint" IS NULL AND
  (("customerPhone" IS NULL) = ("customerPhoneVerifiedAt" IS NULL)) AND (("customerEmail" IS NULL) = ("customerEmailVerifiedAt" IS NULL))) OR
 (source = 'MANUAL' AND "customerId" IS NULL AND "enteredByIdentityId" IS NOT NULL AND "manualFingerprint" IS NOT NULL AND "manualFingerprint" ~ '^[a-f0-9]{64}$' AND
  length(btrim("customerName")) BETWEEN 2 AND 120 AND "customerName" IS NOT NULL AND "customerPhone" IS NOT NULL AND "customerPhone" ~ '^\+[1-9][0-9]{7,14}$' AND
  "customerPhoneVerifiedAt" IS NULL AND "customerEmailVerifiedAt" IS NULL AND ("manualReason" IS NULL OR length(btrim("manualReason")) BETWEEN 5 AND 500))) ;
ALTER TABLE "BookingEvent" DROP CONSTRAINT "BookingEvent_source_check", DROP CONSTRAINT "BookingEvent_reason_check";
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_source_check" CHECK (source IN ('CUSTOMER','PROVIDER','SYSTEM','MANUAL')),
 ADD CONSTRAINT "BookingEvent_reason_check" CHECK (reason IN ('LEGACY_BASELINE','FINAL_CONSENT','CUSTOMER_REQUEST','PROVIDER_REQUEST','APPOINTMENT_FINISHED','CUSTOMER_ABSENT','SYSTEM_CHANGE','MANUAL_ENTRY','MANUAL_CONTACT_EXCEPTION'));
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
    IF NOT FOUND OR ((policy."requireVerifiedPhone" OR policy."requireVerifiedEmail") AND length(btrim(coalesce(NEW."manualReason",''))) < 5) THEN
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

-- Guest contacts are unverified; no automatic notification intent/delivery is claimed.
CREATE OR REPLACE FUNCTION visit_record_booking_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE notification_kind TEXT;
BEGIN
 IF EXISTS (SELECT 1 FROM "Booking" WHERE id = NEW."bookingId" AND "businessId" = NEW."businessId" AND source = 'MANUAL') THEN RETURN NEW; END IF;
 notification_kind := CASE WHEN NEW.kind = 'CREATED' AND NEW."newStatus" = 'CONFIRMED' THEN 'BOOKING_CONFIRMED' WHEN NEW.kind = 'RESCHEDULED' THEN 'BOOKING_RESCHEDULED' WHEN NEW.kind = 'CANCELLED' THEN 'BOOKING_CANCELLED' END;
 IF notification_kind IS NOT NULL THEN INSERT INTO "BookingNotification" ("businessId","bookingId","eventId",kind,"createdAt") VALUES (NEW."businessId",NEW."bookingId",NEW.id,notification_kind,NEW."createdAt") ON CONFLICT ("eventId") DO NOTHING; END IF;
 RETURN NEW;
END $$;
COMMIT;
