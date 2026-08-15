import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import bcrypt from 'bcryptjs';

export const TEST_FACILITY_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_USER_PASSWORD = 'admin123';

const prisma = new PrismaClient();

beforeAll(async () => {
  // Every upsert below sets `update` to the same shape as `create`, deliberately.
  //
  // These fixture IDs are ALSO used by packages/db/prisma/seed.ts with different
  // values — rate plan …550 is "Potato Seasonal 2026" there, restricted to POTATO and
  // open only 2026-03-01 → 09-30, versus the unrestricted full-year plan this suite
  // needs. An `update: {}` (or `update: { isActive: true }`) leaves the seeded values
  // in place, so the suite silently inherits whichever definition happened to be
  // written first. That passed for months on a laptop where setup.ts had won the race,
  // and failed the moment CI ran `db:seed` before the tests: eleven payment tests
  // rejecting lots as outside the season window.
  //
  // A fixture must assert its own preconditions, not hope the row is absent.
  await prisma.facility.upsert({
    where: { id: TEST_FACILITY_ID },
    update: { name: 'Test Facility', city: 'Lahore', settings: { backdating_max_days: null } },
    create: {
      id: TEST_FACILITY_ID,
      name: 'Test Facility',
      city: 'Lahore',
      // Unlimited backdating: fixtures across the suite create historically-
      // dated lots/outbounds as OPERATOR; the new 7-day production default
      // (DEFAULT_FACILITY_SETTINGS.backdating_max_days) would reject them.
      settings: { backdating_max_days: null },
    },
  });

  const passwordHash = await bcrypt.hash(TEST_USER_PASSWORD, 10);

  const testUsers = [
    { id: '00000000-0000-0000-0000-000000000010', email: 'admin@coldchain.pk', name: 'Test Admin', role: 'OWNER' as const },
    { id: '00000000-0000-0000-0000-000000000011', email: 'manager@coldchain.pk', name: 'Test Manager', role: 'MANAGER' as const },
    { id: '00000000-0000-0000-0000-000000000012', email: 'accountant@coldchain.pk', name: 'Test Accountant', role: 'ACCOUNTANT' as const },
    { id: '00000000-0000-0000-0000-000000000013', email: 'operator@coldchain.pk', name: 'Test Operator', role: 'OPERATOR' as const },
    { id: '00000000-0000-0000-0000-000000000014', email: 'security@coldchain.pk', name: 'Test Security', role: 'SECURITY' as const },
  ];

  for (const u of testUsers) {
    await prisma.user.upsert({
      where: { facilityId_email: { facilityId: TEST_FACILITY_ID, email: u.email } },
      update: { passwordHash, failedLoginCount: 0, lockedUntil: null, isActive: true },
      create: { id: u.id, facilityId: TEST_FACILITY_ID, email: u.email, passwordHash, name: u.name, role: u.role },
    });
  }

  // Seed commodities for tests
  await prisma.commodity.upsert({
    where: { id: '00000000-0000-0000-0000-000000000100' },
    update: { name: 'POTATO', unitLabel: 'Bags', defaultStorageDaysAlert: 180 },
    create: { id: '00000000-0000-0000-0000-000000000100', name: 'POTATO', unitLabel: 'Bags', defaultStorageDaysAlert: 180 },
  });

  // Seed a second commodity for restriction tests
  await prisma.commodity.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: { name: 'APPLE', unitLabel: 'Bags', defaultStorageDaysAlert: 120 },
    create: { id: '00000000-0000-0000-0000-000000000101', name: 'APPLE', unitLabel: 'Bags', defaultStorageDaysAlert: 120 },
  });

  // ── Phase 2 fixtures ──────────────────────────────────────────

  // Test chamber (unrestricted, 1000-bag capacity)
  await prisma.chamber.upsert({
    where: { id: '00000000-0000-0000-0000-000000000200' },
    update: { facilityId: TEST_FACILITY_ID, name: 'Test Chamber A', maxCapacityBags: 1000, commodityRestrictionId: null, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000200',
      facilityId: TEST_FACILITY_ID,
      name: 'Test Chamber A',
      maxCapacityBags: 1000,
      isActive: true,
    },
  });

  // Test chamber restricted to POTATO (for restriction mismatch test)
  await prisma.chamber.upsert({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    update: { facilityId: TEST_FACILITY_ID, name: 'Test Chamber B (POTATO only)', maxCapacityBags: 500, commodityRestrictionId: '00000000-0000-0000-0000-000000000100', isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000201',
      facilityId: TEST_FACILITY_ID,
      name: 'Test Chamber B (POTATO only)',
      maxCapacityBags: 500,
      commodityRestrictionId: '00000000-0000-0000-0000-000000000100',
      isActive: true,
    },
  });

  // Small chamber for capacity overflow test
  await prisma.chamber.upsert({
    where: { id: '00000000-0000-0000-0000-000000000202' },
    update: { facilityId: TEST_FACILITY_ID, name: 'Test Chamber C (tiny)', maxCapacityBags: 10, commodityRestrictionId: null, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000202',
      facilityId: TEST_FACILITY_ID,
      name: 'Test Chamber C (tiny)',
      maxCapacityBags: 10,
      isActive: true,
    },
  });

  // Racks for placement/movement tests: two in Chamber A, one in Chamber B
  // (cross-room placement must be rejected), one inactive in Chamber A.
  const testRacks = [
    { id: '00000000-0000-0000-0000-000000000210', chamberId: '00000000-0000-0000-0000-000000000200', name: 'R-1', maxCapacityBags: 400, position: 0, isActive: true },
    { id: '00000000-0000-0000-0000-000000000211', chamberId: '00000000-0000-0000-0000-000000000200', name: 'R-2', maxCapacityBags: 400, position: 1, isActive: true },
    { id: '00000000-0000-0000-0000-000000000212', chamberId: '00000000-0000-0000-0000-000000000201', name: 'R-1', maxCapacityBags: 250, position: 0, isActive: true },
    { id: '00000000-0000-0000-0000-000000000213', chamberId: '00000000-0000-0000-0000-000000000200', name: 'R-X (inactive)', maxCapacityBags: 400, position: 2, isActive: false },
  ];
  for (const r of testRacks) {
    await prisma.rack.upsert({
      where: { id: r.id },
      update: { ...r, facilityId: TEST_FACILITY_ID },
      create: { ...r, facilityId: TEST_FACILITY_ID },
    });
  }

  // Accounting-suite fixtures — referenced by fixed id from
  // accounting.integration.test.ts; a freshly provisioned database has
  // neither, so seed them here rather than relying on leftover rows.
  await prisma.chamber.upsert({
    where: { id: '00000000-0000-0000-0000-000000000300' },
    update: { facilityId: TEST_FACILITY_ID, name: 'Chamber A', maxCapacityBags: 10000, commodityRestrictionId: null, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000300',
      facilityId: TEST_FACILITY_ID,
      name: 'Chamber A',
      maxCapacityBags: 10000,
      isActive: true,
    },
  });
  await prisma.ratePlan.upsert({
    where: { id: '00000000-0000-0000-0000-000000000550' },
    update: {
      facilityId: TEST_FACILITY_ID,
      name: 'Accounting Seasonal Rate',
      rateType: 'SEASONAL_PER_BAG',
      rateAmountPkr: 50,
      minBillingDays: 1,
      // seed.ts claims this id for a POTATO-only plan open 2026-03-01..09-30.
      // Widen it back, or every historically-dated fixture lot is rejected.
      commodityId: null,
      seasonStartDate: new Date('2026-01-01'),
      seasonEndDate: new Date('2026-12-31'),
      isActive: true,
    },
    create: {
      id: '00000000-0000-0000-0000-000000000550',
      facilityId: TEST_FACILITY_ID,
      name: 'Accounting Seasonal Rate',
      rateType: 'SEASONAL_PER_BAG',
      rateAmountPkr: 50,
      minBillingDays: 1,
      seasonStartDate: new Date('2026-01-01'),
      seasonEndDate: new Date('2026-12-31'),
      isActive: true,
    },
  });

  // Test rate plan (MONTHLY_PER_BAG, no commodity restriction)
  await prisma.ratePlan.upsert({
    where: { id: '00000000-0000-0000-0000-000000000500' },
    update: { facilityId: TEST_FACILITY_ID, name: 'Test Monthly Rate', rateType: 'MONTHLY_PER_BAG', rateAmountPkr: 100, minBillingDays: 1, commodityId: null, seasonStartDate: null, seasonEndDate: null, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000500',
      facilityId: TEST_FACILITY_ID,
      name: 'Test Monthly Rate',
      rateType: 'MONTHLY_PER_BAG',
      rateAmountPkr: 100,
      minBillingDays: 1,
      isActive: true,
    },
  });

  // Test service charge
  await prisma.serviceCharge.upsert({
    where: { id: '00000000-0000-0000-0000-000000000600' },
    update: { facilityId: TEST_FACILITY_ID, name: 'Test Loading Charge', unitType: 'PER_BAG', unitPricePkr: 10, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000600',
      facilityId: TEST_FACILITY_ID,
      name: 'Test Loading Charge',
      unitType: 'PER_BAG',
      unitPricePkr: 10,
      isActive: true,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
