ALTER TABLE "Identity" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "authenticationProofHash" TEXT;
CREATE UNIQUE INDEX "Session_authenticationProofHash_key" ON "Session"("authenticationProofHash");
