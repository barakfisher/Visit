-- Worker access slice 2: an invitation and a membership can name one staff row (calendar).
ALTER TABLE "Membership" ADD COLUMN "staffId" TEXT;
ALTER TABLE "BusinessInvitation" ADD COLUMN "staffId" TEXT;

-- Same-business only: the composite key makes a row from another business unreachable.
-- NO ACTION (checked at statement end) lets a business delete cascade through members and staff together;
-- a staff row someone is or was linked to cannot be deleted on its own, so removal archives it.
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_staffId_fkey" FOREIGN KEY ("businessId", "staffId") REFERENCES "Staff"("businessId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "BusinessInvitation" ADD CONSTRAINT "BusinessInvitation_businessId_staffId_fkey" FOREIGN KEY ("businessId", "staffId") REFERENCES "Staff"("businessId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "BusinessInvitation_businessId_staffId_idx" ON "BusinessInvitation"("businessId", "staffId");

-- At most one active account per staff row, and one linked staff row per account in a business.
CREATE UNIQUE INDEX "Membership_active_staff_key" ON "Membership"("businessId", "staffId") WHERE status = 'ACTIVE' AND "staffId" IS NOT NULL;
CREATE UNIQUE INDEX "Membership_active_identity_staff_key" ON "Membership"("businessId", "identityId") WHERE status = 'ACTIVE' AND "staffId" IS NOT NULL;
