-- SMS delivery has never been configured, so no customer could prove a phone and every business
-- requiring one was unbookable. The API now refuses the requirement while SMS is off
-- (decisions.md, 2026-11-03 verified phone); owners can turn it on again once SMS exists.
UPDATE "BookingPolicy" SET "requireVerifiedPhone" = false WHERE "requireVerifiedPhone";
