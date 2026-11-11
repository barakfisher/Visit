BEGIN;
SET LOCAL lock_timeout = '5s';
-- A business's own record of a customer (customer-cards.md). Linked to an app account only by the
-- person's own act: their own booking, or (later) an invite they open and confirm. Never by a typed phone.
-- The app never hard-deletes a business or an account; a privileged purge takes their cards too. A card with
-- bookings still cannot go (the booking's key restricts it).
CREATE TABLE "CustomerCard" (
  id TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"(id) ON DELETE CASCADE,
  name TEXT CHECK (name IS NULL OR length(btrim(name)) BETWEEN 2 AND 120),
  phone TEXT CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  email TEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  "identityId" TEXT REFERENCES "Identity"(id) ON DELETE CASCADE,
  "linkedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCard_link_pair" CHECK (("identityId" IS NULL) = ("linkedAt" IS NULL)),
  -- A card the business typed always has the name and phone it was saved with.
  CONSTRAINT "CustomerCard_unlinked_contacts" CHECK ("identityId" IS NOT NULL OR (name IS NOT NULL AND phone IS NOT NULL)),
  UNIQUE ("businessId", id)
);
-- Within a business the phone is the duplicate check for typed cards; an account has one card per business.
CREATE UNIQUE INDEX "CustomerCard_businessId_phone_unlinked_key" ON "CustomerCard"("businessId", phone) WHERE "identityId" IS NULL;
CREATE UNIQUE INDEX "CustomerCard_businessId_identityId_key" ON "CustomerCard"("businessId", "identityId") WHERE "identityId" IS NOT NULL;
CREATE INDEX "CustomerCard_identityId_idx" ON "CustomerCard"("identityId") WHERE "identityId" IS NOT NULL;
CREATE INDEX "CustomerCard_businessId_phone_idx" ON "CustomerCard"("businessId", phone);

-- The composite key keeps a booking on a card of its own business. customerId and the contact
-- snapshots stay immutable; only this reference moves (a merge on claim, PR B).
ALTER TABLE "Booking" ADD COLUMN "customerCardId" TEXT,
  ADD CONSTRAINT "Booking_customerCard_fkey" FOREIGN KEY ("businessId", "customerCardId") REFERENCES "CustomerCard"("businessId", id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Booking_customerCardId_startsAt_idx" ON "Booking"("customerCardId", "startsAt") WHERE "customerCardId" IS NOT NULL;
COMMIT;
