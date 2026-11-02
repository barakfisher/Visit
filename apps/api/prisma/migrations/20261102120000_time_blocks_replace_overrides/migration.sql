-- Time blocks replace date overrides (decisions.md, "Time blocks with a reason — 2026-11-02").
-- A block without a staff member covers the whole business; allDay marks whole local days.
ALTER TABLE "TimeBlock" ALTER COLUMN "staffId" DROP NOT NULL;
ALTER TABLE "TimeBlock" ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "TimeBlock_businessId_startsAt_endsAt_idx" ON "TimeBlock"("businessId", "startsAt", "endsAt");

-- A closed date becomes a whole-day block from local midnight to the next local midnight.
-- "Open only from-to" dates are dropped: weekly hours and blocks now express that.
INSERT INTO "TimeBlock" ("id", "businessId", "staffId", "startsAt", "endsAt", "allDay")
SELECT 'override_' || o."id", o."businessId", NULL,
  (o."date"::timestamp AT TIME ZONE b."timezone") AT TIME ZONE 'UTC',
  ((o."date" + 1)::timestamp AT TIME ZONE b."timezone") AT TIME ZONE 'UTC',
  true
FROM "ScheduleOverride" o JOIN "Business" b ON b."id" = o."businessId"
WHERE NOT o."isOpen";

INSERT INTO "TimeBlock" ("id", "businessId", "staffId", "startsAt", "endsAt", "allDay")
SELECT 'override_' || o."id", o."businessId", o."staffId",
  (o."date"::timestamp AT TIME ZONE b."timezone") AT TIME ZONE 'UTC',
  ((o."date" + 1)::timestamp AT TIME ZONE b."timezone") AT TIME ZONE 'UTC',
  true
FROM "StaffScheduleOverride" o JOIN "Business" b ON b."id" = o."businessId"
WHERE NOT o."isOpen";

DROP TABLE "ScheduleOverride";
DROP TABLE "StaffScheduleOverride";
