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

  // ============================================================
  // PHASE 2: Rate Plans, Service Charges
  // ============================================================

  console.log('\n  --- Phase 2 Seed Data ---');

  const ratePlans = [
    {
      id: '00000000-0000-0000-0000-000000000550',
      facilityId: facility.id,
      name: 'Potato Seasonal 2026',
      commodityId: commodities[0]!.id, // POTATO
      rateType: 'SEASONAL_PER_BAG' as const,
      rateAmountPkr: 250,
      seasonStartDate: new Date('2026-03-01'),
      seasonEndDate: new Date('2026-09-30'),
      minBillingDays: 7,
      isActive: true,
    },
    {
      id: '00000000-0000-0000-0000-000000000551',
      facilityId: facility.id,
      name: 'Apple Monthly 2026',
      commodityId: commodities[1]!.id, // APPLE
      rateType: 'MONTHLY_PER_BAG' as const,
      rateAmountPkr: 80,
      minBillingDays: 1,
      isActive: true,
    },
    {
      id: '00000000-0000-0000-0000-000000000552',
      facilityId: facility.id,
      name: 'General Daily Rate',
      commodityId: null,
      rateType: 'DAILY_PER_BAG' as const,
      rateAmountPkr: 5,
      minBillingDays: 1,
      isActive: true,
    },
  ];

  for (const rp of ratePlans) {
    await prisma.ratePlan.upsert({
      where: { id: rp.id },
      update: {},
      create: rp,
    });
    console.log(`  Rate Plan: ${rp.name} (${rp.rateType}, Rs. ${rp.rateAmountPkr}/bag)`);
  }

  const serviceCharges = [
    {
      id: '00000000-0000-0000-0000-000000000650',
      facilityId: facility.id,
      name: 'Loading',
      unitType: 'PER_BAG' as const,
      unitPricePkr: 10,
      isActive: true,
    },
    {
      id: '00000000-0000-0000-0000-000000000651',
      facilityId: facility.id,
      name: 'Unloading',
      unitType: 'PER_BAG' as const,
      unitPricePkr: 10,
      isActive: true,
    },
    {
      id: '00000000-0000-0000-0000-000000000652',
      facilityId: facility.id,
      name: 'Sorting',
      unitType: 'PER_BAG' as const,
      unitPricePkr: 15,
      isActive: true,
    },
  ];

  for (const sc of serviceCharges) {
    await prisma.serviceCharge.upsert({
      where: { id: sc.id },
      update: {},
      create: sc,
    });
    console.log(`  Service Charge: ${sc.name} (${sc.unitType}, Rs. ${sc.unitPricePkr})`);
  }

  // ============================================================
  // PHASE 8: ACCOUNTING — CHART OF ACCOUNTS (§2 of 09_accounting_spec.md)
  // ============================================================

  console.log('\n  --- Phase 8 Seed Data (Chart of Accounts) ---');

  type CoaSeed = {
    code: string;
    name: string;
    cls: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST_OF_SERVICE' | 'EXPENSE';
    type: 'HEADER' | 'DETAIL';
    parent: string | null;
    normal: 'DEBIT' | 'CREDIT';
    system?: boolean;
  };

  const coa: CoaSeed[] = [
    // CLASS 1: ASSETS
    { code: '1000', name: 'Cash & Bank', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT' },
    { code: '1010', name: 'Cash on Hand', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT' },
    { code: '1020', name: 'Bank Account — Main', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT' },
    { code: '1030', name: 'Mobile Wallet Receipts', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT' },
    { code: '1100', name: 'Trade Receivables', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT' },
    { code: '1110', name: 'Receivable — Farmers', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
    { code: '1120', name: 'Receivable — Traders', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
    { code: '1130', name: 'Receivable — Arhtis', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
    { code: '1140', name: 'Receivable — Peshgi (Loans)', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT' },
    { code: '1150', name: 'Receivable — Other', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT' },
    { code: '1200', name: 'Other Current Assets', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT' },
    { code: '1210', name: 'Advance Payments to Suppliers', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
    { code: '1220', name: 'Prepaid Electricity (Security Deposit)', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
    { code: '1300', name: 'Fixed Assets', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT' },
    { code: '1310', name: 'Cold Storage Plant & Equipment', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT' },
    { code: '1311', name: 'Accum. Depreciation — Plant & Equipment', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT' },
    { code: '1320', name: 'Building / Civil Works', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT' },
    { code: '1321', name: 'Accum. Depreciation — Building', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT' },
    { code: '1330', name: 'Vehicles', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT' },
    { code: '1331', name: 'Accum. Depreciation — Vehicles', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT' },
    { code: '1340', name: 'Computer & Software', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT' },
    { code: '1341', name: 'Accum. Depreciation — Computer', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT' },

    // CLASS 2: LIABILITIES
    { code: '2000', name: 'Current Liabilities', cls: 'LIABILITY', type: 'HEADER', parent: null, normal: 'CREDIT' },
    { code: '2010', name: 'Advance Receipts from Clients', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
    { code: '2020', name: 'GST Payable — Output Tax', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
    { code: '2030', name: 'Salaries Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
    { code: '2040', name: 'Utility Bills Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
    { code: '2060', name: 'EOBI Payable — Employee Portion', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
    { code: '2061', name: 'EOBI Payable — Employer Portion', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
    { code: '2070', name: 'Income Tax Withheld Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
    { code: '2080', name: 'Damage / Spoilage Liability Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
    { code: '2100', name: 'Long-Term Liabilities', cls: 'LIABILITY', type: 'HEADER', parent: null, normal: 'CREDIT' },
    { code: '2110', name: 'Bank Loan — Equipment Finance', cls: 'LIABILITY', type: 'DETAIL', parent: '2100', normal: 'CREDIT' },
    { code: '2120', name: 'Loan from Director / Owner', cls: 'LIABILITY', type: 'DETAIL', parent: '2100', normal: 'CREDIT' },

    // CLASS 3: EQUITY
    { code: '3010', name: "Owner's Capital", cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT' },
    { code: '3020', name: 'Retained Earnings', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT' },
    { code: '3030', name: 'Current Year Profit / (Loss)', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT' },

    // CLASS 4: REVENUE
    { code: '4000', name: 'Storage Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT' },
    { code: '4010', name: 'Storage Revenue — Potato', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT' },
    { code: '4020', name: 'Storage Revenue — Apple', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT' },
    { code: '4030', name: 'Storage Revenue — Onion', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT' },
    { code: '4040', name: 'Storage Revenue — Kinnow', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT' },
    { code: '4050', name: 'Storage Revenue — Other', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT' },
    { code: '4100', name: 'Handling & Service Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT' },
    { code: '4110', name: 'Loading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
    { code: '4120', name: 'Unloading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
    { code: '4130', name: 'Sorting & Grading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
    { code: '4140', name: 'Packing Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
    { code: '4150', name: 'Other Service Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
    { code: '4200', name: 'Other Income', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT' },
    { code: '4210', name: 'Late Payment Surcharge', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT' },
    { code: '4220', name: 'Damage Settlement Received', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT' },

    // CLASS 5: COST OF SERVICES (Direct)
    { code: '5000', name: 'Direct Operating Costs', cls: 'COST_OF_SERVICE', type: 'HEADER', parent: null, normal: 'DEBIT' },
    { code: '5010', name: 'Electricity — Refrigeration', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
    { code: '5020', name: 'Electricity — Facility (Non-Refrig.)', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
    { code: '5030', name: 'Direct Labor — Loaders & Handlers', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
    { code: '5035', name: 'Employer EOBI — Direct Labor', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
    { code: '5040', name: 'Depreciation — Cold Plant', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
    { code: '5050', name: 'Refrigerant & Consumables', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
    { code: '5060', name: 'Packaging & Materials', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },

    // CLASS 6: OPERATING EXPENSES (Indirect)
    { code: '6000', name: 'Indirect / Overhead Expenses', cls: 'EXPENSE', type: 'HEADER', parent: null, normal: 'DEBIT' },
    { code: '6010', name: 'Salaries — Management & Office', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6015', name: 'Employer EOBI — Management & Office', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6020', name: 'Rent', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6030', name: 'Maintenance & Repairs', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6040', name: 'Fuel & Vehicle', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6050', name: 'Insurance', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6060', name: 'Communication', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6070', name: 'Computer & Software', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6080', name: 'Bad Debt Expense', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6090', name: 'Bank Charges', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6100', name: 'Miscellaneous', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
    { code: '6150', name: 'Spoilage / Damage Compensation Expense', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  ];

  for (const a of coa) {
    await prisma.chartOfAccounts.upsert({
      where: { facilityId_accountCode: { facilityId: facility.id, accountCode: a.code } },
      update: {
        accountName: a.name,
        accountClass: a.cls,
        accountType: a.type,
        parentAccountCode: a.parent,
        normalBalance: a.normal,
        isSystemAccount: a.system ?? false,
      },
      create: {
        facilityId: facility.id,
        accountCode: a.code,
        accountName: a.name,
        accountClass: a.cls,
        accountType: a.type,
        parentAccountCode: a.parent,
        normalBalance: a.normal,
        isSystemAccount: a.system ?? false,
      },
    });
  }
  console.log(`  Chart of Accounts: ${coa.length} accounts seeded`);

  // Wire revenue account codes to existing rate plans and service charges so JE-01 can route by commodity/service.
  // Commodity → revenue account (per JE-01 spec):
  const commodityRevenueMap: Record<string, string> = {
    POTATO: '4010',
    APPLE: '4020',
    ONION: '4030',
    KINNOW: '4040',
  };

  for (const rp of ratePlans) {
    const cmd = commodities.find((c) => c.id === rp.commodityId);
    const code = cmd ? (commodityRevenueMap[cmd.name] ?? '4050') : '4050';
    await prisma.ratePlan.update({
      where: { id: rp.id },
      data: { revenueAccountCode: code },
    });
  }
  console.log(`  Rate Plans: revenue_account_code wired by commodity`);

  // Service → revenue account (per JE-01 spec):
  const serviceRevenueMap: Record<string, string> = {
    Loading: '4110',
    Unloading: '4120',
    Sorting: '4130',
    Packing: '4140',
  };

  for (const sc of serviceCharges) {
    const code = serviceRevenueMap[sc.name] ?? '4150';
    await prisma.serviceCharge.update({
      where: { id: sc.id },
      data: { revenueAccountCode: code },
    });
  }
  console.log(`  Service Charges: revenue_account_code wired by service name`);

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
