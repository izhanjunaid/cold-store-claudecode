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

  await prisma.user.upsert({
    where: {
      facilityId_email: {
        facilityId: TEST_FACILITY_ID,
        email: 'admin@coldchain.pk',
      },
    },
    update: { passwordHash, failedLoginCount: 0, lockedUntil: null, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      facilityId: TEST_FACILITY_ID,
      email: 'admin@coldchain.pk',
      passwordHash,
      name: 'Test Admin',
      role: 'OWNER',
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
