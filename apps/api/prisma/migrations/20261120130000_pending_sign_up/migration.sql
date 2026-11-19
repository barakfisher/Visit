-- Login plan stage 2, slice 1: a password sign-up waits here until a six-digit code proves its email
-- (login-plan-stage-2.md; decisions.md, "Verified password sign-up").
CREATE TABLE "PendingSignUp" (
    "id" TEXT NOT NULL,
    "handleHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "locale" TEXT NOT NULL,
    "existingAccount" BOOLEAN NOT NULL DEFAULT false,
    "codeHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "deliveredAt" TIMESTAMPTZ,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingSignUp_pkey" PRIMARY KEY ("id"),
    -- A row for a registered address never carries a password or a code.
    CONSTRAINT "PendingSignUp_existing_account_empty" CHECK (NOT "existingAccount" OR ("passwordHash" IS NULL AND "codeHash" IS NULL)),
    CONSTRAINT "PendingSignUp_locale" CHECK ("locale" IN ('he', 'en'))
);
CREATE UNIQUE INDEX "PendingSignUp_handleHash_key" ON "PendingSignUp"("handleHash");
CREATE INDEX "PendingSignUp_email_consumedAt_idx" ON "PendingSignUp"("email", "consumedAt");
CREATE INDEX "PendingSignUp_expiresAt_idx" ON "PendingSignUp"("expiresAt");
