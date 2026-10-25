ALTER TABLE "SecurityNotification" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'live';
DROP INDEX "SecurityNotification_status_nextAttemptAt_idx";
CREATE INDEX "SecurityNotification_scope_status_nextAttemptAt_idx" ON "SecurityNotification"("scope","status","nextAttemptAt");
