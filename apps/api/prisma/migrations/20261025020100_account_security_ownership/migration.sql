CREATE UNIQUE INDEX "Session_id_identityId_key" ON "Session"("id","identityId");
CREATE UNIQUE INDEX "IdentitySecurityEvent_id_identityId_key" ON "IdentitySecurityEvent"("id","identityId");
ALTER TABLE "AccountContactChallenge" DROP CONSTRAINT "AccountContactChallenge_sessionId_fkey";
ALTER TABLE "AccountContactChallenge" ADD CONSTRAINT "AccountContactChallenge_sessionId_identityId_fkey" FOREIGN KEY ("sessionId","identityId") REFERENCES "Session"("id","identityId") ON DELETE CASCADE;
ALTER TABLE "SecurityNotification" DROP CONSTRAINT "SecurityNotification_eventId_fkey";
ALTER TABLE "SecurityNotification" ADD CONSTRAINT "SecurityNotification_eventId_identityId_fkey" FOREIGN KEY ("eventId","identityId") REFERENCES "IdentitySecurityEvent"("id","identityId") ON DELETE CASCADE;
