-- Worker access slice 5: a membership is the owner or a member; what a member may do is in four switches
-- (worker-access.md, Privileges; decisions.md, "Switches"). A new enum value cannot be used in the transaction that
-- adds it, so it gets a migration of its own. MANAGER and STAFF stay in the enum: invitations name them as the
-- starting preset, and the access audit keeps its history.
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'MEMBER';
