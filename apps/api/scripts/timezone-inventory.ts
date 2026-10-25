// Read-only aggregate inventory. No names, contacts, booking IDs or mutations.
import { prisma } from '../src/db/client.js';
try {
  const inventory = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const businesses = await tx.business.groupBy({ by: ['timezone', 'approvalStatus'], _count: { _all: true } });
    const bookings = await tx.$queryRaw<{ timezone: string; status: string; count: number }[]>`SELECT b.timezone, a.status::text AS status, count(*)::int AS count FROM "Booking" a JOIN "Business" b ON b.id = a."businessId" GROUP BY b.timezone, a.status ORDER BY b.timezone, a.status`;
    return { businesses, bookings };
  }, { isolationLevel: 'RepeatableRead' });
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ...inventory }, null, 2));
} finally { await prisma.$disconnect(); }
