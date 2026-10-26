CREATE TABLE "BookingAttempt" (
  id TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "customerId" TEXT NOT NULL REFERENCES "Identity"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  "bookingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingAttempt_committed_reference" CHECK (status <> 'CONFIRMED' OR "bookingId" IS NOT NULL)
);
CREATE UNIQUE INDEX "BookingAttempt_businessId_idempotencyKey_key" ON "BookingAttempt"("businessId", "idempotencyKey");
CREATE INDEX "BookingAttempt_customerId_status_idx" ON "BookingAttempt"("customerId", status);
