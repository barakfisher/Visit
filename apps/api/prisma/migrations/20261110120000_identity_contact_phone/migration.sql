-- A phone the person typed on their profile. It is not a sign-in method and is not verified: it never satisfies a
-- business's verified-phone requirement and is not shared with businesses. It is not unique, so typing someone
-- else's number cannot block them from adding it as their own sign-in method later.
ALTER TABLE "Identity" ADD COLUMN "contactPhone" TEXT CHECK ("contactPhone" IS NULL OR "contactPhone" ~ '^\+[1-9][0-9]{7,14}$');
