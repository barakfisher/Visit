-- All pilot currencies use two minor-unit decimal places. Unknown prices are a null pair.
ALTER TABLE "Service" ADD CONSTRAINT "Service_details_valid" CHECK (
  length(btrim(name)) BETWEEN 2 AND 120 AND "durationMinutes" BETWEEN 5 AND 1440
  AND (description IS NULL OR length(btrim(description)) <= 2000)
  AND (("priceMinor" IS NULL AND currency IS NULL) OR
    ("priceMinor" IS NOT NULL AND "priceMinor" BETWEEN 0 AND 2000000000 AND currency IS NOT NULL AND currency IN ('ILS', 'USD', 'EUR', 'GBP')))
);
ALTER TABLE "Booking" ADD COLUMN "serviceName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "serviceDurationMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "servicePriceMinor" INTEGER,
  ADD COLUMN "serviceCurrency" TEXT;
-- Legacy names/prices cannot be reconstructed after past edits. Capture the current catalog
-- once; duration is recoverable from the persisted appointment interval.
UPDATE "Booking" b SET "serviceName" = s.name,
  "serviceDurationMinutes" = (extract(epoch FROM (b."endsAt" - b."startsAt")) / 60)::integer,
  "servicePriceMinor" = s."priceMinor", "serviceCurrency" = s.currency
FROM "Service" s WHERE s.id = b."serviceId" AND s."businessId" = b."businessId";
CREATE FUNCTION visit_booking_service_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service_row "Service"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO service_row FROM "Service" WHERE id = NEW."serviceId" AND "businessId" = NEW."businessId" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service does not belong to this business' USING ERRCODE = '23503'; END IF;
    IF NOT service_row.active THEN RAISE EXCEPTION 'Service is archived' USING ERRCODE = '23514'; END IF;
    NEW."serviceName" := service_row.name;
    NEW."serviceDurationMinutes" := service_row."durationMinutes";
    NEW."servicePriceMinor" := service_row."priceMinor";
    NEW."serviceCurrency" := service_row.currency;
  ELSE
    IF NEW."serviceId" IS DISTINCT FROM OLD."serviceId" OR NEW."businessId" IS DISTINCT FROM OLD."businessId"
      OR NEW."serviceName" IS DISTINCT FROM OLD."serviceName"
      OR NEW."serviceDurationMinutes" IS DISTINCT FROM OLD."serviceDurationMinutes"
      OR NEW."servicePriceMinor" IS DISTINCT FROM OLD."servicePriceMinor"
      OR NEW."serviceCurrency" IS DISTINCT FROM OLD."serviceCurrency" THEN
      RAISE EXCEPTION 'Booking service snapshot is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER booking_service_snapshot BEFORE INSERT OR UPDATE ON "Booking"
FOR EACH ROW EXECUTE FUNCTION visit_booking_service_snapshot();
