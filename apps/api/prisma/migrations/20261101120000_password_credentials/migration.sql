-- MVP email+password sign-in. Only scrypt hashes in the application's self-describing format are stored.
CREATE TABLE "PasswordCredential" (
 "identityId" TEXT NOT NULL PRIMARY KEY REFERENCES "Identity"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 hash TEXT NOT NULL CHECK (hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$'),
 "unprovenEmail" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
