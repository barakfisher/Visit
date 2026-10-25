ALTER TABLE "Staff" ADD COLUMN "creationKey" TEXT, ADD COLUMN "creationFingerprint" TEXT;
CREATE UNIQUE INDEX "Staff_businessId_creationKey_key" ON "Staff"("businessId", "creationKey");
