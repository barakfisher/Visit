-- A removed staff member with booking history is archived instead of deleted,
-- because bookings reference staff with a restrictive foreign key.
ALTER TABLE "Staff" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
