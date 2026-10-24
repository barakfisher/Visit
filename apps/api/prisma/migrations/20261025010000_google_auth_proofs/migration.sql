CREATE TABLE "GoogleAuthProof" (
  hash TEXT PRIMARY KEY,
  "identityId" TEXT NOT NULL REFERENCES "Identity"(id) ON DELETE CASCADE,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GoogleAuthProof_identityId_idx" ON "GoogleAuthProof"("identityId");
