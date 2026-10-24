ALTER TABLE "Business" ADD COLUMN "location" TEXT, ADD COLUMN "category" TEXT NOT NULL DEFAULT 'General';
CREATE TABLE "TimeBlock" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimeBlock_valid_range" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "TimeBlock_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TimeBlock_businessId_staffId_fkey" FOREIGN KEY ("businessId", "staffId") REFERENCES "Staff"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TimeBlock_businessId_staffId_startsAt_endsAt_idx" ON "TimeBlock"("businessId", "staffId", "startsAt", "endsAt");
