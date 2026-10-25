// Run manually by a trusted database operator, never from a public HTTP request.
import { parseArgs } from 'node:util';
import { prisma } from '../src/db/client.js';
import { promoteAdministrator } from '../src/security/admin-role.js';
const { values } = parseArgs({ options: { identity: { type: 'string' }, operator: { type: 'string' }, reason: { type: 'string' }, confirm: { type: 'boolean' } } });
try {
  if (!values.confirm || !values.identity || !values.operator?.trim() || (values.reason?.trim().length ?? 0) < 10) throw new Error('Require --identity ID --operator NAME --reason reviewed-evidence-reference --confirm. Review ownership first; never select an account by released email alone.');
  await promoteAdministrator({ identity: values.identity, operator: values.operator!, reason: values.reason! });
  console.log('Administrator promotion recorded. Sign in again.');
} finally { await prisma.$disconnect(); }
