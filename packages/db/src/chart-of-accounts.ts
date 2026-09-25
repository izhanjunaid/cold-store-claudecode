import type { PrismaClient } from '@prisma/client';

/**
 * Standard cold-storage Chart of Accounts (per docs/09_accounting_spec.md §2).
 *
 * This is REQUIRED master/reference data, not demo data: the accounting engine posts
 * journal entries to these account codes, so every facility — dev or production — needs
 * it. It is loaded by the clean `provision.ts` flow and by the dev `seed.ts`.
 *
 * One definition: prisma/seed.ts, prisma/provision.ts and prisma/deploy.ts all read this
 * array, so a change here reaches dev, clean installs and client updates alike.
 */
export type StatementSectionSeed =
  | 'CURRENT_ASSET'
  | 'NON_CURRENT_ASSET'
  | 'CURRENT_LIABILITY'
  | 'NON_CURRENT_LIABILITY'
  | 'REVENUE'
  | 'CONTRA_REVENUE'
  | 'OTHER_INCOME'
  | 'COST_OF_SERVICE'
  | 'OPERATING_EXPENSE'
  | 'OTHER_EXPENSE';

export type CoaSeed = {
  code: string;
  name: string;
  cls: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST_OF_SERVICE' | 'EXPENSE';
  type: 'HEADER' | 'DETAIL';
  parent: string | null;
  normal: 'DEBIT' | 'CREDIT';
  system?: boolean;
  /** HEADER only — which statement section its children roll up into (phase/24). Absent = unclassified bucket. */
  section?: StatementSectionSeed;
  /** Cash or a bank/wallet account (is_cash_equivalent). */
  cash?: boolean;
  /** false: only the account's own documents or automated flow may post to it (allow_manual_posting). */
  manual?: false;
  /** Every line must name a party (requires_party). */
  party?: boolean;
};

/** The columns a seed row sets — shared by seed and sync so the two cannot drift. */
function rowData(a: CoaSeed) {
  return {
    accountName: a.name,
    accountClass: a.cls,
    accountType: a.type,
    parentAccountCode: a.parent,
    normalBalance: a.normal,
    isSystemAccount: a.system ?? false,
    statementSection: a.section ?? null,
    isCashEquivalent: a.cash ?? false,
    allowManualPosting: a.manual ?? true,
    requiresParty: a.party ?? false,
  };
}

export const CHART_OF_ACCOUNTS: CoaSeed[] = [
  // CLASS 1: ASSETS
  { code: '1000', name: 'Cash & Bank', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'CURRENT_ASSET' },
  { code: '1010', name: 'Cash on Hand', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true, cash: true },
  { code: '1025', name: 'Cheques in Hand (Under Collection)', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true, manual: false },
  { code: '1020', name: 'Bank Account — Main', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true, cash: true },
  { code: '1030', name: 'Mobile Wallet Receipts', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true, cash: true },
  { code: '1100', name: 'Trade Receivables', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'CURRENT_ASSET' },
  { code: '1110', name: 'Receivable — Farmers', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true, party: true },
  { code: '1120', name: 'Receivable — Traders', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true, party: true },
  { code: '1130', name: 'Receivable — Arhtis', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true, party: true },
  { code: '1140', name: 'Receivable — Peshgi (Loans)', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true, manual: false, party: true },
  { code: '1150', name: 'Receivable — Other', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true, party: true },
  { code: '1200', name: 'Other Current Assets', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'CURRENT_ASSET' },
  { code: '1210', name: 'Advance Payments to Suppliers', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
  { code: '1220', name: 'Prepaid Electricity (Security Deposit)', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
  { code: '1230', name: 'Advances to Employees', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT', manual: false },
  // Tax customers withhold from payments to us under s.153. It is an advance
  // of our own income tax, not a discount — without this account the withheld
  // amount silently becomes an unexplained shortfall in the party's AR.
  { code: '1240', name: 'Tax Withheld at Source — Receivable', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
  // Contra-entry for the monthly storage-revenue accrual (JE-25). Deliberately
  // under 1200 and not under 1100 Trade Receivables: it is not owed by anyone
  // yet, so it must never reach AR ageing or the AR control accounts.
  { code: '1250', name: 'Accrued Storage Revenue (Unbilled)', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT', system: true, manual: false },
  // Only used where the facility is registered for provincial sales tax on
  // services; harmless and unposted otherwise.
  { code: '1260', name: 'Sales Tax — Input / Adjustable', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
  { code: '1300', name: 'Fixed Assets', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'NON_CURRENT_ASSET' },
  { code: '1310', name: 'Cold Storage Plant & Equipment', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT', system: true },
  { code: '1311', name: 'Accum. Depreciation — Plant & Equipment', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT', system: true },
  { code: '1320', name: 'Building / Civil Works', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT', system: true },
  { code: '1321', name: 'Accum. Depreciation — Building', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT', system: true },
  { code: '1330', name: 'Vehicles', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT', system: true },
  { code: '1331', name: 'Accum. Depreciation — Vehicles', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT', system: true },
  { code: '1340', name: 'Computer & Software', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT', system: true },
  { code: '1341', name: 'Accum. Depreciation — Computer', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT', system: true },
  { code: '1350', name: 'Capital Work in Progress', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT' },
  { code: '1360', name: 'Intangible Assets — Software', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT' },
  { code: '1361', name: 'Accum. Amortisation — Software', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT' },
  // Impairment is kept apart from accumulated depreciation on purpose.
  // Depreciation is systematic allocation over a useful life; impairment is a
  // one-off write-down. Merging them makes the standard disclosure — cost,
  // accumulated depreciation, accumulated impairment, carrying amount —
  // impossible to reconstruct, and 1311/1321/1331/1341 are named for
  // depreciation. One shared account rather than one per class is the
  // proportionate choice at this scale.
  { code: '1370', name: 'Accum. Impairment — Fixed Assets', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT', system: true },
  // Furniture, fixtures and anything that is not plant, building, vehicle or
  // computer. OTHER-category assets used to post to 1310 Cold Storage Plant and
  // depreciate into 6100 Miscellaneous (docs/25 C-34).
  { code: '1380', name: 'Furniture, Fixtures & Other Equipment', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'DEBIT', system: true },
  { code: '1381', name: 'Accum. Depreciation — Furniture & Other', cls: 'ASSET', type: 'DETAIL', parent: '1300', normal: 'CREDIT', system: true },

  // CLASS 2: LIABILITIES
  { code: '2000', name: 'Current Liabilities', cls: 'LIABILITY', type: 'HEADER', parent: null, normal: 'CREDIT', system: true, section: 'CURRENT_LIABILITY' },
  { code: '2010', name: 'Advance Receipts from Clients', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true, manual: false, party: true },
  { code: '2020', name: 'GST Payable — Output Tax', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2030', name: 'Salaries Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true, manual: false },
  { code: '2040', name: 'Utility Bills Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  // What the facility owes its suppliers, by supplier. Before payables existed every
  // accrued bill — rent, repairs, refrigerant — credited 2040 above (docs/25 C-01).
  { code: '2050', name: 'Trade Payables — Suppliers', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true, party: true },
  { code: '2060', name: 'EOBI Payable — Employee Portion', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2061', name: 'EOBI Payable — Employer Portion', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2070', name: 'Income Tax Withheld — Salaries (s.149)', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  // We are a withholding agent on payments out, not only on payroll. Kept as
  // separate accounts because the s.165 statement reports by section, and
  // splitting a single balance afterwards is guesswork.
  { code: '2071', name: 'Tax Withheld — Suppliers & Services (s.153)', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
  { code: '2072', name: 'Tax Withheld — Rent (s.155)', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
  { code: '2080', name: 'Damage / Spoilage Liability Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
  { code: '2100', name: 'Long-Term Liabilities', cls: 'LIABILITY', type: 'HEADER', parent: null, normal: 'CREDIT', system: true, section: 'NON_CURRENT_LIABILITY' },
  { code: '2110', name: 'Bank Loan — Equipment Finance', cls: 'LIABILITY', type: 'DETAIL', parent: '2100', normal: 'CREDIT' },
  { code: '2120', name: 'Loan from Director / Owner', cls: 'LIABILITY', type: 'DETAIL', parent: '2100', normal: 'CREDIT' },

  // CLASS 3: EQUITY
  // Partner equity is grouped, like every other class. Without these headers
  // equity was the only class whose DETAIL accounts sat at the root, which is
  // why the Add Account form had no parent to derive a code from and an owner
  // adding a second partner had to invent one. Both take the CLASS normal
  // balance — a header never posts, and contra-ness lives on the DETAIL
  // children, the same shape as 4900/4910 and 1300/1311.
  //
  // Deliberately 3100/3200 rather than 3000/3100: suggestNextCode runs a block
  // from a header to the next header of the same class, so these yield clean
  // 3110/3120... and 3210/3220... runs regardless of what the seed already
  // occupies in 30xx — where the system plug and the two derived accounts live,
  // belonging to no partner and so deliberately left at the root.
  { code: '3100', name: "Partners' Capital", cls: 'EQUITY', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '3200', name: "Partners' Drawings", cls: 'EQUITY', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  // Where the guided opening-balance entry balances to, and nothing else. It was
  // called "Owner's Capital" while doing two jobs at once: a sole proprietor's real
  // capital account AND the plug. One name cannot be right for both, and on a
  // facility with two owners the capital half belongs to nobody — so the balance
  // sheet showed a residual under a person's label. Every owner now gets a named
  // account under 3100 instead, including a sole one, and this account means only
  // "not yet attributed". A non-zero balance here is a to-do, not a figure.
  { code: '3010', name: 'Opening Balance Equity', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT', system: true },
  // NOT seeded: 3015 "Owner's Drawings". Every owner gets their own drawings
  // account under 3200, created with their capital account when the partner is
  // added — a generic one is only ever right for a facility with exactly one
  // owner, and it was being resurrected on every update. sync is INSERT-only, so
  // an account missing from this array is one it re-added the moment an owner
  // deleted it, which is exactly what docs/09 told them to do. An existing 3015
  // is left alone: with postings it keeps its history, without them it can be
  // deleted and now stays deleted.
  { code: '3020', name: 'Retained Earnings', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT', manual: false },
  { code: '3030', name: 'Current Year Profit / (Loss)', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT', system: true, manual: false },

  // CLASS 4: REVENUE
  { code: '4000', name: 'Storage Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true, section: 'REVENUE' },
  { code: '4010', name: 'Storage Revenue — Potato', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4020', name: 'Storage Revenue — Apple', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4030', name: 'Storage Revenue — Onion', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4040', name: 'Storage Revenue — Kinnow', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4050', name: 'Storage Revenue — Other', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4100', name: 'Handling & Service Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true, section: 'REVENUE' },
  { code: '4110', name: 'Loading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4120', name: 'Unloading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4130', name: 'Sorting & Grading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4140', name: 'Packing Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4150', name: 'Other Service Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT', system: true },
  { code: '4200', name: 'Other Income', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true, section: 'OTHER_INCOME' },
  { code: '4210', name: 'Late Payment Surcharge', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT' },
  { code: '4220', name: 'Damage Settlement Received', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT' },
  { code: '4230', name: 'Gain on Disposal of Asset', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT', system: true, manual: false },
  { code: '4900', name: 'Contra Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true, section: 'CONTRA_REVENUE' },
  { code: '4910', name: 'Discounts Allowed', cls: 'REVENUE', type: 'DETAIL', parent: '4900', normal: 'DEBIT', system: true },

  // CLASS 5: COST OF SERVICES (Direct)
  { code: '5000', name: 'Direct Operating Costs', cls: 'COST_OF_SERVICE', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'COST_OF_SERVICE' },
  { code: '5010', name: 'Electricity — Refrigeration', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
  { code: '5020', name: 'Electricity — Facility (Non-Refrig.)', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
  { code: '5030', name: 'Direct Labor — Loaders & Handlers', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT', system: true, manual: false },
  { code: '5035', name: 'Employer EOBI — Direct Labor', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT', system: true, manual: false },
  { code: '5040', name: 'Depreciation — Cold Plant', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT', system: true, manual: false },
  { code: '5050', name: 'Refrigerant & Consumables', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
  { code: '5060', name: 'Packaging & Materials', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },

  // CLASS 6: OPERATING EXPENSES (Indirect)
  { code: '6000', name: 'Indirect / Overhead Expenses', cls: 'EXPENSE', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'OPERATING_EXPENSE' },
  { code: '6010', name: 'Salaries — Management & Office', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6015', name: 'Employer EOBI — Management & Office', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6020', name: 'Rent', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6030', name: 'Maintenance & Repairs', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6040', name: 'Fuel & Vehicle', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6050', name: 'Insurance', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6060', name: 'Communication', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6070', name: 'Computer & Software', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6080', name: 'Bad Debt Expense', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6090', name: 'Bank Charges', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6100', name: 'Miscellaneous', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6120', name: 'Depreciation — Building', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6130', name: 'Depreciation — Vehicles', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6140', name: 'Amortisation — Software', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6150', name: 'Spoilage / Damage Compensation Expense', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6160', name: 'Impairment Loss — Fixed Assets', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  // Computer hardware depreciated into 6140 "Amortisation — Software" and OTHER
  // assets into 6100 Miscellaneous, which the EBITDA add-back then swallowed whole
  // (docs/25 C-34, L-21).
  { code: '6170', name: 'Depreciation — Computers', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  { code: '6180', name: 'Depreciation — Furniture & Other', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true, manual: false },
  // A forgiven staff advance is an employee benefit, not a customer bad debt (C-27).
  { code: '6190', name: 'Staff Welfare & Benefits', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },

  // CLASS 6 (continued): NON-OPERATING EXPENSES — below operating profit,
  // same idea as 4200 Other Income on the revenue side (phase/25).
  { code: '6900', name: 'Non-Operating Expenses', cls: 'EXPENSE', type: 'HEADER', parent: null, normal: 'DEBIT', system: true, section: 'OTHER_EXPENSE' },
  { code: '6110', name: 'Loss on Disposal of Asset', cls: 'EXPENSE', type: 'DETAIL', parent: '6900', normal: 'DEBIT', system: true, manual: false },
];

/** Upsert the standard chart of accounts for a facility. Returns the number of accounts. */
export async function seedChartOfAccounts(
  prisma: PrismaClient,
  facilityId: string,
): Promise<number> {
  for (const a of CHART_OF_ACCOUNTS) {
    await prisma.chartOfAccounts.upsert({
      where: { facilityId_accountCode: { facilityId, accountCode: a.code } },
      update: rowData(a),
      create: { facilityId, accountCode: a.code, ...rowData(a) },
    });
  }
  return CHART_OF_ACCOUNTS.length;
}

/**
 * Add accounts this release introduced to an EXISTING facility. Returns how many
 * were added. Safe to run on every update — that is the point.
 *
 * INSERT-only, unlike seedChartOfAccounts above. An owner may rename or re-parent
 * their own accounts, so upserting the whole array against a live facility would
 * clobber those edits. An account that is *missing* cannot carry any edits, so
 * adding it is always safe, and one rule covers every future account.
 *
 * It refuses — and so fails the deploy, which the settings screen reports — when a
 * code the seed claims is already occupied by an account of a different class or
 * type. The registry posts to that code by role; adopting an owner's unrelated
 * account there would post, say, supplier payables into their "Misc. income".
 * Renumber the owner's account first (scripts/preupdate-checks-consolidation.sql
 * C20 lists them).
 *
 * ponytail: an owner who deleted an unused non-system account will see it return on
 * the next update. Cosmetic; the alternative — an account missing that the posting
 * engine writes to — is a hard runtime failure. Add a tombstone column if a client
 * ever complains.
 */
export async function syncChartOfAccounts(
  prisma: PrismaClient,
  facilityId: string,
): Promise<number> {
  const existing = await prisma.chartOfAccounts.findMany({
    where: { facilityId },
    select: { accountCode: true, accountClass: true, accountType: true },
  });
  const byCode = new Map(existing.map((a) => [a.accountCode, a]));

  const collisions = CHART_OF_ACCOUNTS.filter((a) => {
    const found = byCode.get(a.code);
    return found && (found.accountClass !== a.cls || found.accountType !== a.type);
  });
  if (collisions.length > 0) {
    throw new Error(
      `Chart of accounts: ${collisions.map((a) => a.code).join(', ')} already exist with a different class or type ` +
        `than the system account this release needs at that code. Renumber them, then update again.`,
    );
  }

  const missing = CHART_OF_ACCOUNTS.filter((a) => !byCode.has(a.code));
  for (const a of missing) {
    await prisma.chartOfAccounts.create({ data: { facilityId, accountCode: a.code, ...rowData(a) } });
  }

  // The one structural fixup that is not an insert: 6110 Loss on Disposal moved from
  // 6000 (operating) to 6900 (non-operating) in phase/25, so a loss on disposal lands
  // on the same side of operating profit as a gain. guard_chart_of_accounts forbids
  // re-parenting an account with postings — correctly, that would restate a closed
  // period — so it is only attempted where 6110 has none. (This used to be a
  // try/catch that swallowed every error, not just that one.) A facility whose 6110
  // already carries postings keeps it under 6000, visibly, on its chart.
  const lossPosted = await prisma.journalEntryLine.count({ where: { facilityId, accountCode: '6110' } });
  if (lossPosted === 0) {
    await prisma.chartOfAccounts.updateMany({
      where: { facilityId, accountCode: '6110', parentAccountCode: '6000' },
      data: { parentAccountCode: '6900' },
    });
  }

  // The plug's name, for boxes seeded before it was separated from a real capital
  // account. Scoped to the exact old name so an owner who renamed it keeps theirs.
  // Renaming is safe where re-parenting is not: the guard never locks a name, and no
  // posting logic reads it.
  await prisma.chartOfAccounts.updateMany({
    where: { facilityId, accountCode: '3010', accountName: "Owner's Capital" },
    data: { accountName: 'Opening Balance Equity' },
  });

  return missing.length;
}
