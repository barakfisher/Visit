BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE "ManualBookingAttempt" (
 id TEXT PRIMARY KEY, "businessId" TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "Identity"(id) ON DELETE CASCADE,
 "idempotencyKey" TEXT NOT NULL, fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REJECTED')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE ("businessId","idempotencyKey")
);
CREATE FUNCTION visit_manual_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent "ManualBookingAttempt"%ROWTYPE;
BEGIN
 IF TG_OP = 'INSERT' AND NEW.source = 'MANUAL' THEN
  SELECT * INTO intent FROM "ManualBookingAttempt" WHERE "businessId" = NEW."businessId" AND "idempotencyKey" = NEW."idempotencyKey" FOR SHARE;
  IF NOT FOUND OR intent.status <> 'PENDING' OR intent."actorId" IS DISTINCT FROM NEW."enteredByIdentityId" OR intent.fingerprint IS DISTINCT FROM NEW."manualFingerprint" THEN
   RAISE EXCEPTION 'VISIT_MANUAL_ATTEMPT_REJECTED' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual_attempt_guard BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION visit_manual_attempt_guard();
COMMIT;
