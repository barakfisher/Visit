-- Password sign-up proves the email with a six-digit code before the account exists (login-plan-stage-2.md, slice 1).
CREATE TABLE "PendingSignUp" (
    "id" TEXT NOT NULL,
    "handleHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "codeHash" TEXT,
    "locale" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "deliveredAt" TIMESTAMPTZ,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingSignUp_pkey" PRIMARY KEY ("id"),
    -- A code is stored only with the password it will create the account with.
    CONSTRAINT "PendingSignUp_code_needs_password_check" CHECK (("codeHash" IS NULL) = ("passwordHash" IS NULL)),
    CONSTRAINT "PendingSignUp_locale_check" CHECK ("locale" IN ('he', 'en'))
);

CREATE UNIQUE INDEX "PendingSignUp_handleHash_key" ON "PendingSignUp"("handleHash");
CREATE INDEX "PendingSignUp_email_consumedAt_idx" ON "PendingSignUp"("email", "consumedAt");
CREATE INDEX "PendingSignUp_expiresAt_idx" ON "PendingSignUp"("expiresAt");
