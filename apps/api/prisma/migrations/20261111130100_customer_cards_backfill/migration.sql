BEGIN;
SET LOCAL lock_timeout = '5s';
-- One card per (business, phone) for guests and per (business, account) for app customers.
-- Only bookings that were ever confirmed count: they have a lifecycle event. An expired or released hold
-- (released holds end CANCELLED too) is not a customer. A card takes the
-- contacts of the latest booking, which are what the business already received: for an app customer
-- that is only verified contacts, never today's profile. Bookings that already have a card are left
-- alone, so a second run changes nothing. The function is dropped after this one run: run again later, it
-- would also file bookings saved with "Save customer details" off. Tests recreate it from this file.
CREATE FUNCTION visit_backfill_customer_cards(target_business TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "CustomerCard" (id, "businessId", name, phone, email)
  SELECT gen_random_uuid()::text, "businessId",
    (array_agg("customerName" ORDER BY "createdAt" DESC, id DESC))[1], "customerPhone",
    (array_agg("customerEmail" ORDER BY "createdAt" DESC, id DESC) FILTER (WHERE "customerEmail" IS NOT NULL))[1]
  FROM "Booking"
  WHERE source = 'MANUAL' AND "customerCardId" IS NULL AND (target_business IS NULL OR "businessId" = target_business)
  GROUP BY "businessId", "customerPhone"
  ON CONFLICT ("businessId", phone) WHERE "identityId" IS NULL DO NOTHING;
  UPDATE "Booking" b SET "customerCardId" = c.id FROM "CustomerCard" c
  WHERE b.source = 'MANUAL' AND b."customerCardId" IS NULL AND (target_business IS NULL OR b."businessId" = target_business)
    AND c."businessId" = b."businessId" AND c."identityId" IS NULL AND c.phone = b."customerPhone";

  INSERT INTO "CustomerCard" (id, "businessId", name, phone, email, "identityId", "linkedAt")
  SELECT gen_random_uuid()::text, "businessId",
    (array_agg("customerName" ORDER BY "createdAt" DESC, id DESC) FILTER (WHERE "customerName" IS NOT NULL))[1],
    (array_agg("customerPhone" ORDER BY "createdAt" DESC, id DESC) FILTER (WHERE "customerPhone" IS NOT NULL))[1],
    (array_agg("customerEmail" ORDER BY "createdAt" DESC, id DESC) FILTER (WHERE "customerEmail" IS NOT NULL))[1],
    "customerId", CURRENT_TIMESTAMP
  FROM "Booking"
  WHERE source = 'CUSTOMER' AND "customerCardId" IS NULL AND status IN ('CONFIRMED','COMPLETED','NO_SHOW','CANCELLED')
    AND EXISTS (SELECT 1 FROM "BookingEvent" e WHERE e."businessId" = "Booking"."businessId" AND e."bookingId" = "Booking".id)
    AND (target_business IS NULL OR "businessId" = target_business)
  GROUP BY "businessId", "customerId"
  ON CONFLICT ("businessId", "identityId") WHERE "identityId" IS NOT NULL DO NOTHING;
  UPDATE "Booking" b SET "customerCardId" = c.id FROM "CustomerCard" c
  WHERE b.source = 'CUSTOMER' AND b."customerCardId" IS NULL AND b.status IN ('CONFIRMED','COMPLETED','NO_SHOW','CANCELLED')
    AND EXISTS (SELECT 1 FROM "BookingEvent" e WHERE e."businessId" = b."businessId" AND e."bookingId" = b.id)
    AND (target_business IS NULL OR b."businessId" = target_business)
    AND c."businessId" = b."businessId" AND c."identityId" = b."customerId";
END $$;
SELECT visit_backfill_customer_cards(NULL);
DROP FUNCTION visit_backfill_customer_cards(TEXT);
COMMIT;
