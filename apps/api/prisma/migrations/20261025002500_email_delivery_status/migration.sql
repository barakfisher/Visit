ALTER TABLE "EmailChallenge" ADD COLUMN "deliveredAt" TIMESTAMP(3);
-- Previously issued challenges were created before delivery and invalidated on
-- known failure; preserve already-issued links during their short remaining TTL.
UPDATE "EmailChallenge" SET "deliveredAt" = "createdAt";
