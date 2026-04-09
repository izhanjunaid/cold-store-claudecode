import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import bcrypt from 'bcryptjs';

export const TEST_FACILITY_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_USER_PASSWORD = 'admin123';

const prisma = new PrismaClient();

beforeAll(async () => {
  // Ensure test facility and user exist
  await prisma.facility.upsert({
    where: { id: TEST_FACILITY_ID },
    update: {},
    create: {
      id: TEST_FACILITY_ID,
      name: 'Test Facility',
      city: 'Lahore',
      settings: {},
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
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000100', name: 'POTATO', unitLabel: 'Bags', defaultStorageDaysAlert: 180 },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
