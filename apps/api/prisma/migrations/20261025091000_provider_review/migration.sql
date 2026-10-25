ALTER TABLE "Business" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "ProviderApplication" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'LEGACY', ADD COLUMN "reviewReason" TEXT;
CREATE TABLE "ProviderReviewNotification" (
  "id" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL UNIQUE REFERENCES "ProviderApplication"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL DEFAULT 'live', "destination" TEXT, "locale" TEXT, "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "leaseUntil" TIMESTAMPTZ,
  "acceptedAt" TIMESTAMPTZ, "provider" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ProviderReviewNotification_scope_status_nextAttemptAt_idx" ON "ProviderReviewNotification"("scope", "status", "nextAttemptAt");
CREATE TABLE "AdminRoleAudit" ("id" TEXT PRIMARY KEY, "identityId" TEXT NOT NULL, "operator" TEXT NOT NULL, "reason" TEXT NOT NULL, "previousRole" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now());
