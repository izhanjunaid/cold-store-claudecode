import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

// bcryptjs hash of 'admin123' with 10 rounds
// Pre-computed to avoid needing bcryptjs as a seed dependency
const ADMIN_PASSWORD_HASH = '$2a$10$qeCjtZftGtPYgSz2HgOfVekOtcMvmclxPNJH04C9spvcHolg0bnFK';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default facility
  const facility = await prisma.facility.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Lahore Cold Store',
      address: 'Multan Road, Near Mandi, Lahore',
      city: 'Lahore',
      phone: '042-35761234',
      settings: {
        weight_dispute_threshold_pct: 2,
        chamber_capacity_warning_pct: 90,
        number_format: 'international',
        gst_enabled: false,
      },
    },
  });
  console.log(`  Facility: ${facility.name} (${facility.id})`);

  // Create OWNER user
  const owner = await prisma.user.upsert({
    where: {
      facilityId_email: {
        facilityId: facility.id,
        email: 'admin@coldchain.pk',
      },
    },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      facilityId: facility.id,
      email: 'admin@coldchain.pk',
      passwordHash: ADMIN_PASSWORD_HASH,
      name: 'Tariq Ahmad',
      nameUrdu: 'طارق احمد',
      role: 'OWNER',
    },
  });
  console.log(`  Owner: ${owner.name} <${owner.email}> (${owner.role})`);

  // Create additional users for testing
  const users = [
    {
      id: '00000000-0000-0000-0000-000000000011',
      email: 'manager@coldchain.pk',
      name: 'Shahid Iqbal',
      nameUrdu: 'شاہد اقبال',
      role: 'MANAGER' as const,
    },
    {
      id: '00000000-0000-0000-0000-000000000012',
      email: 'accountant@coldchain.pk',
      name: 'Asma Bibi',
      nameUrdu: 'اسماء بی بی',
      role: 'ACCOUNTANT' as const,
    },
    {
      id: '00000000-0000-0000-0000-000000000013',
      email: 'operator@coldchain.pk',
      name: 'Waseem Khan',
      nameUrdu: 'وسیم خان',
      role: 'OPERATOR' as const,
    },
    {
      id: '00000000-0000-0000-0000-000000000014',
      email: 'security@coldchain.pk',
      name: 'Rashid Ali',
      nameUrdu: 'راشد علی',
      role: 'SECURITY' as const,
    },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: {
        facilityId_email: {
          facilityId: facility.id,
          email: u.email,
        },
      },
      update: {},
      create: {
        id: u.id,
        facilityId: facility.id,
        email: u.email,
        passwordHash: ADMIN_PASSWORD_HASH,
        name: u.name,
        nameUrdu: u.nameUrdu,
        role: u.role,
      },
    });
    console.log(`  ${user.role}: ${user.name} <${user.email}>`);
  }

  // ============================================================
  // PHASE 1: Commodities, Varieties, Chambers, Parties
  // ============================================================

  console.log('\n  --- Phase 1 Seed Data ---');

  // Commodities
  const commodities = [
    { id: '00000000-0000-0000-0000-000000000100', name: 'POTATO', unitLabel: 'Bags', defaultStorageDaysAlert: 180 },
    { id: '00000000-0000-0000-0000-000000000101', name: 'APPLE', unitLabel: 'Crates', defaultStorageDaysAlert: 90 },
    { id: '00000000-0000-0000-0000-000000000102', name: 'ONION', unitLabel: 'Bags', defaultStorageDaysAlert: 120 },
    { id: '00000000-0000-0000-0000-000000000103', name: 'KINNOW', unitLabel: 'Crates', defaultStorageDaysAlert: 60 },
  ];

  for (const c of commodities) {
    await prisma.commodity.upsert({
      where: { id: c.id },
      update: {},
      create: c,
    });
    console.log(`  Commodity: ${c.name} (${c.unitLabel})`);
  }

  // Varieties
  const varieties = [
    { id: '00000000-0000-0000-0000-000000000200', commodityId: commodities[0]!.id, name: 'Cardinal' },
    { id: '00000000-0000-0000-0000-000000000201', commodityId: commodities[0]!.id, name: 'Desiree' },
    { id: '00000000-0000-0000-0000-000000000202', commodityId: commodities[0]!.id, name: 'Kuroda' },
    { id: '00000000-0000-0000-0000-000000000203', commodityId: commodities[1]!.id, name: 'Royal Gala' },
    { id: '00000000-0000-0000-0000-000000000204', commodityId: commodities[1]!.id, name: 'Golden Delicious' },
    { id: '00000000-0000-0000-0000-000000000205', commodityId: commodities[2]!.id, name: 'Red' },
    { id: '00000000-0000-0000-0000-000000000206', commodityId: commodities[2]!.id, name: 'White' },
    { id: '00000000-0000-0000-0000-000000000207', commodityId: commodities[3]!.id, name: 'Standard' },
  ];

  for (const v of varieties) {
    await prisma.variety.upsert({
      where: { id: v.id },
      update: {},
      create: v,
    });
    console.log(`  Variety: ${v.name}`);
  }

  // Chambers
  const chambers = [
    { id: '00000000-0000-0000-0000-000000000300', facilityId: facility.id, name: 'Chamber A', commodityRestrictionId: commodities[0]!.id, maxCapacityBags: 10000, temperatureMinC: 2.0, temperatureMaxC: 4.0 },
    { id: '00000000-0000-0000-0000-000000000301', facilityId: facility.id, name: 'Chamber B', commodityRestrictionId: commodities[0]!.id, maxCapacityBags: 8000, temperatureMinC: 2.0, temperatureMaxC: 4.0 },
    { id: '00000000-0000-0000-0000-000000000302', facilityId: facility.id, name: 'Chamber C', commodityRestrictionId: null, maxCapacityBags: 5000, temperatureMinC: 0.0, temperatureMaxC: 5.0 },
    { id: '00000000-0000-0000-0000-000000000303', facilityId: facility.id, name: 'Chamber D', commodityRestrictionId: commodities[1]!.id, maxCapacityBags: 3000, temperatureMinC: -1.0, temperatureMaxC: 2.0 },
  ];

  for (const ch of chambers) {
    await prisma.chamber.upsert({
      where: { id: ch.id },
      update: {},
      create: ch,
    });
    console.log(`  Chamber: ${ch.name} (max ${ch.maxCapacityBags} bags)`);
  }

  // Parties — create Arhti first so farmers can reference it
  const arhtiId = '00000000-0000-0000-0000-000000000401';
  await prisma.party.upsert({
    where: { id: arhtiId },
    update: {},
    create: {
      id: arhtiId,
      facilityId: facility.id,
      name: 'Hameed Commission Agency',
      nameUrdu: 'حمید کمیشن ایجنسی',
      partyType: 'ARHTI',
      phonePrimary: '03211234567',
      address: 'Shop 12, Mandi Lahore',
      creditLimitPkr: 2000000,
      creditTermsDays: 45,
      createdBy: owner.id,
    },
  });
  console.log('  Party: Hameed Commission Agency (ARHTI)');

  const partySeedData = [
    {
      id: '00000000-0000-0000-0000-000000000400',
      facilityId: facility.id,
      name: 'Ghulam Hussain',
      nameUrdu: 'غلام حسین',
      partyType: 'FARMER' as const,
      phonePrimary: '03001234567',
      address: 'Village Kamoke, District Gujranwala',
      parentArhtiId: arhtiId,
      creditLimitPkr: 500000,
      createdBy: owner.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000402',
      facilityId: facility.id,
      name: 'Muhammad Akbar',
      nameUrdu: 'محمد اکبر',
      partyType: 'FARMER' as const,
      phonePrimary: '03009876543',
      address: 'Village Okara',
      createdBy: owner.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000403',
      facilityId: facility.id,
      name: 'Ahmad Trading Co.',
      nameUrdu: 'احمد ٹریڈنگ کمپنی',
      partyType: 'TRADER' as const,
      phonePrimary: '03331112233',
      address: 'Lahore Wholesale Market',
      creditLimitPkr: 1000000,
      creditTermsDays: 15,
      createdBy: owner.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000404',
      facilityId: facility.id,
      name: 'Karachi Fresh Mart',
      nameUrdu: 'کراچی فریش مارٹ',
      partyType: 'BUYER' as const,
      phonePrimary: '03214567890',
      address: 'Sabzi Mandi, Karachi',
      createdBy: owner.id,
    },
  ];

  for (const p of partySeedData) {
    await prisma.party.upsert({
      where: { id: p.id },
      update: {},
      create: p,
    });
    console.log(`  Party: ${p.name} (${p.partyType})`);
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
