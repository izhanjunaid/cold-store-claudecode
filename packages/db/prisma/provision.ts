/**
 * provision.ts — CLEAN production onboarding for a new client.
 *
 * Creates ONLY:
 *   - the client's facility
 *   - the client's real users (each with a unique strong temporary password and
 *     must_change_password = true)
 *   - the standard Chart of Accounts (required master data)
 *
 * It creates NO demo/test/sample data (no parties, commodities, chambers, rate plans,
 * or transactions) and refuses to run unless the database is empty (clean install),
 * unless PROVISION_FORCE=1 is set.
 *
 * Input: a JSON config (see scripts/client-config.example.json). Path via CLIENT_CONFIG
 * (default ./prisma/client-config.json).
 *
 *   CLIENT_CONFIG=/path/to/client-config.json pnpm --filter @coldchain/db db:provision
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { readFileSync } from 'fs';
import { seedChartOfAccounts } from './chart-of-accounts';

const VALID_ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY', 'VIEWER'] as const;
type Role = (typeof VALID_ROLES)[number];

// Single-facility box deployment: the web login sends this fixed facility id (hard-coded
// in apps/web/src/app/(auth)/login/page.tsx), so the provisioned facility MUST use it or
// staff cannot log in. One facility per box, so a fixed id is correct here.
const SINGLE_FACILITY_ID = '00000000-0000-0000-0000-000000000001';

interface ClientUser {
  name: string;
  nameUrdu?: string;
  email: string;
  role: Role;
}

interface ClientConfig {
  facility: {
    name: string;
    address?: string;
    city?: string;
    phone?: string;
    gstRegistered?: boolean;
    gstNumber?: string | null;
    numberFormat?: string;
  };
  users: ClientUser[];
  loadChartOfAccounts?: boolean; // default true
}

/** Strong, human-distributable temp password; no ambiguous characters (0/O/1/l/I). */
function genTempPassword(length = 14): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#%+=?'];
  const all = sets.join('');
  const pick = (s: string) => s[randomInt(s.length)]!;
  const chars = sets.map(pick); // guarantee one from each class
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function fail(msg: string): never {
  console.error(`\n[provision] ${msg}\n`);
  process.exit(1);
}

async function main() {
  const cfgPath = process.env['CLIENT_CONFIG'] || 'prisma/client-config.json';
  let cfg: ClientConfig;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as ClientConfig;
  } catch {
    fail(
      `Could not read client config at "${cfgPath}".\n` +
        `Copy scripts/client-config.example.json to client-config.json, fill it in, and set CLIENT_CONFIG.`,
    );
  }

  // ---- validate ----
  const errors: string[] = [];
  if (!cfg.facility?.name?.trim()) errors.push('facility.name is required');
  if (!Array.isArray(cfg.users) || cfg.users.length === 0) errors.push('at least one user is required');

  const seenEmails = new Set<string>();
  let owners = 0;
  (cfg.users ?? []).forEach((u, i) => {
    if (!u?.name?.trim()) errors.push(`users[${i}].name is required`);
    const email = u?.email?.trim().toLowerCase();
    if (!email) errors.push(`users[${i}].email is required`);
    else if (seenEmails.has(email)) errors.push(`duplicate email: ${email}`);
    else seenEmails.add(email);
    if (!VALID_ROLES.includes(u?.role)) errors.push(`users[${i}].role invalid: "${u?.role}" (one of ${VALID_ROLES.join(', ')})`);
    if (u?.role === 'OWNER') owners++;
  });
  if (cfg.users?.length && owners < 1) errors.push('at least one user must have role OWNER');
  if (errors.length) fail('Invalid client config:\n - ' + errors.join('\n - '));

  const prisma = new PrismaClient();
  try {
    // ---- clean-database guard ----
    const [facilityCount, userCount] = await Promise.all([prisma.facility.count(), prisma.user.count()]);
    if ((facilityCount > 0 || userCount > 0) && process.env['PROVISION_FORCE'] !== '1') {
      fail(
        `Database is not clean: found ${facilityCount} facility(ies) and ${userCount} user(s).\n` +
          `Provisioning runs only against a fresh database. If you are certain, re-run with PROVISION_FORCE=1.`,
      );
    }

    const f = cfg.facility;
    const facility = await prisma.facility.create({
      data: {
        id: SINGLE_FACILITY_ID,
        name: f.name.trim(),
        address: f.address?.trim() || null,
        city: f.city?.trim() || 'Lahore',
        phone: f.phone?.trim() || null,
        gstNumber: f.gstNumber?.toString().trim() || null,
        settings: {
          weight_dispute_threshold_kg: 5,
          storage_alert_thresholds: {},
          gst_registered: Boolean(f.gstRegistered || f.gstNumber),
          number_format: f.numberFormat || 'en-PK',
        },
      },
    });

    const creds: { role: string; name: string; email: string; password: string }[] = [];
    for (const u of cfg.users) {
      const password = genTempPassword();
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          facilityId: facility.id,
          email: u.email.trim().toLowerCase(),
          name: u.name.trim(),
          nameUrdu: u.nameUrdu?.trim() || null,
          role: u.role,
          passwordHash,
          mustChangePassword: true,
          isActive: true,
        },
      });
      creds.push({ role: u.role, name: u.name.trim(), email: u.email.trim().toLowerCase(), password });
    }

    const coaCount = cfg.loadChartOfAccounts === false ? 0 : await seedChartOfAccounts(prisma, facility.id);

    // ---- report ----
    console.log('\n========================================================');
    console.log(`  PROVISIONED (clean): ${facility.name}`);
    console.log(`  Facility ID: ${facility.id}`);
    console.log(`  Users: ${creds.length}   Chart of Accounts: ${coaCount}   Demo/test data: 0`);
    console.log('========================================================');
    console.log('\n  TEMPORARY CREDENTIALS — shown ONCE. Distribute securely; each user');
    console.log('  must change their password on first login.\n');
    for (const c of creds) {
      console.log(`   [${c.role}] ${c.name}`);
      console.log(`     email:    ${c.email}`);
      console.log(`     password: ${c.password}\n`);
    }
    console.log('  No demo, test, or sample data was created.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
