import { createTwoTenantFixture, resetTwoTenantFixture } from '../test/support/two-tenant.js';
import { prisma } from '../src/db/client.js';
const [command, run, date] = process.argv.slice(2);
try {
  if (!run || !['create', 'reset'].includes(command ?? '')) throw new Error('Usage: tenant-fixtures.mts create|reset UUID [YYYY-MM-DD]');
  if (command === 'reset') { await resetTwoTenantFixture(run); console.log(JSON.stringify({ reset: true, run })); }
  else {
    const fixture = await createTwoTenantFixture(run, date);
    // Never print session credentials or contact proofs, even for synthetic users.
    console.log(JSON.stringify({ run, date: fixture.date, businessIds: fixture.businesses.map(row => row.id), identities: fixture.people.map((row, index) => ({ actor: ['north', 'south', 'dual', 'staff', 'pending', 'outsider'][index], id: row.id })) }, null, 2));
  }
} finally { await prisma.$disconnect(); }
