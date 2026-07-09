import type { PrismaClient } from '@prisma/client';

/**
 * Standard cold-storage Chart of Accounts (per docs/09_accounting_spec.md §2).
 *
 * This is REQUIRED master/reference data, not demo data: the accounting engine posts
 * journal entries to these account codes, so every facility — dev or production — needs
 * it. It is loaded by the clean `provision.ts` flow and by the dev `seed.ts`.
 *
 * NOTE: the dev seed (seed.ts) currently keeps its own inline copy for demo wiring; if
 * you change the standard chart, update both (or refactor seed.ts to import this).
 */
export type CoaSeed = {
  code: string;
  name: string;
  cls: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST_OF_SERVICE' | 'EXPENSE';
  type: 'HEADER' | 'DETAIL';
  parent: string | null;
  normal: 'DEBIT' | 'CREDIT';
  system?: boolean;
};

export const CHART_OF_ACCOUNTS: CoaSeed[] = [
  // CLASS 1: ASSETS
  { code: '1000', name: 'Cash & Bank', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true },
  { code: '1010', name: 'Cash on Hand', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true },
  { code: '1020', name: 'Bank Account — Main', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true },
  { code: '1030', name: 'Mobile Wallet Receipts', cls: 'ASSET', type: 'DETAIL', parent: '1000', normal: 'DEBIT', system: true },
  { code: '1100', name: 'Trade Receivables', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true },
  { code: '1110', name: 'Receivable — Farmers', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
  { code: '1120', name: 'Receivable — Traders', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
  { code: '1130', name: 'Receivable — Arhtis', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
  { code: '1140', name: 'Receivable — Peshgi (Loans)', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
  { code: '1150', name: 'Receivable — Other', cls: 'ASSET', type: 'DETAIL', parent: '1100', normal: 'DEBIT', system: true },
  { code: '1200', name: 'Other Current Assets', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true },
  { code: '1210', name: 'Advance Payments to Suppliers', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
  { code: '1220', name: 'Prepaid Electricity (Security Deposit)', cls: 'ASSET', type: 'DETAIL', parent: '1200', normal: 'DEBIT' },
  { code: '1300', name: 'Fixed Assets', cls: 'ASSET', type: 'HEADER', parent: null, normal: 'DEBIT', system: true },
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

  // CLASS 2: LIABILITIES
  { code: '2000', name: 'Current Liabilities', cls: 'LIABILITY', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '2010', name: 'Advance Receipts from Clients', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2020', name: 'GST Payable — Output Tax', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2030', name: 'Salaries Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2040', name: 'Utility Bills Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2060', name: 'EOBI Payable — Employee Portion', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2061', name: 'EOBI Payable — Employer Portion', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2070', name: 'Income Tax Withheld Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT', system: true },
  { code: '2080', name: 'Damage / Spoilage Liability Payable', cls: 'LIABILITY', type: 'DETAIL', parent: '2000', normal: 'CREDIT' },
  { code: '2100', name: 'Long-Term Liabilities', cls: 'LIABILITY', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '2110', name: 'Bank Loan — Equipment Finance', cls: 'LIABILITY', type: 'DETAIL', parent: '2100', normal: 'CREDIT' },
  { code: '2120', name: 'Loan from Director / Owner', cls: 'LIABILITY', type: 'DETAIL', parent: '2100', normal: 'CREDIT' },

  // CLASS 3: EQUITY
  { code: '3010', name: "Owner's Capital", cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT', system: true },
  { code: '3020', name: 'Retained Earnings', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT' },
  { code: '3030', name: 'Current Year Profit / (Loss)', cls: 'EQUITY', type: 'DETAIL', parent: null, normal: 'CREDIT', system: true },

  // CLASS 4: REVENUE
  { code: '4000', name: 'Storage Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '4010', name: 'Storage Revenue — Potato', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4020', name: 'Storage Revenue — Apple', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4030', name: 'Storage Revenue — Onion', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4040', name: 'Storage Revenue — Kinnow', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4050', name: 'Storage Revenue — Other', cls: 'REVENUE', type: 'DETAIL', parent: '4000', normal: 'CREDIT', system: true },
  { code: '4100', name: 'Handling & Service Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '4110', name: 'Loading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4120', name: 'Unloading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4130', name: 'Sorting & Grading Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4140', name: 'Packing Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT' },
  { code: '4150', name: 'Other Service Revenue', cls: 'REVENUE', type: 'DETAIL', parent: '4100', normal: 'CREDIT', system: true },
  { code: '4200', name: 'Other Income', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '4210', name: 'Late Payment Surcharge', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT' },
  { code: '4220', name: 'Damage Settlement Received', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT' },
  { code: '4230', name: 'Gain on Disposal of Asset', cls: 'REVENUE', type: 'DETAIL', parent: '4200', normal: 'CREDIT', system: true },
  { code: '4900', name: 'Contra Revenue', cls: 'REVENUE', type: 'HEADER', parent: null, normal: 'CREDIT', system: true },
  { code: '4910', name: 'Discounts Allowed', cls: 'REVENUE', type: 'DETAIL', parent: '4900', normal: 'DEBIT', system: true },

  // CLASS 5: COST OF SERVICES (Direct)
  { code: '5000', name: 'Direct Operating Costs', cls: 'COST_OF_SERVICE', type: 'HEADER', parent: null, normal: 'DEBIT', system: true },
  { code: '5010', name: 'Electricity — Refrigeration', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
  { code: '5020', name: 'Electricity — Facility (Non-Refrig.)', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
  { code: '5030', name: 'Direct Labor — Loaders & Handlers', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT', system: true },
  { code: '5035', name: 'Employer EOBI — Direct Labor', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT', system: true },
  { code: '5040', name: 'Depreciation — Cold Plant', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT', system: true },
  { code: '5050', name: 'Refrigerant & Consumables', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },
  { code: '5060', name: 'Packaging & Materials', cls: 'COST_OF_SERVICE', type: 'DETAIL', parent: '5000', normal: 'DEBIT' },

  // CLASS 6: OPERATING EXPENSES (Indirect)
  { code: '6000', name: 'Indirect / Overhead Expenses', cls: 'EXPENSE', type: 'HEADER', parent: null, normal: 'DEBIT', system: true },
  { code: '6010', name: 'Salaries — Management & Office', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6015', name: 'Employer EOBI — Management & Office', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6020', name: 'Rent', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6030', name: 'Maintenance & Repairs', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6040', name: 'Fuel & Vehicle', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6050', name: 'Insurance', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6060', name: 'Communication', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6070', name: 'Computer & Software', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6080', name: 'Bad Debt Expense', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6090', name: 'Bank Charges', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
  { code: '6100', name: 'Miscellaneous', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6110', name: 'Loss on Disposal of Asset', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6120', name: 'Depreciation — Building', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6130', name: 'Depreciation — Vehicles', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6140', name: 'Amortisation — Software', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT', system: true },
  { code: '6150', name: 'Spoilage / Damage Compensation Expense', cls: 'EXPENSE', type: 'DETAIL', parent: '6000', normal: 'DEBIT' },
];

/** Upsert the standard chart of accounts for a facility. Returns the number of accounts. */
export async function seedChartOfAccounts(
  prisma: PrismaClient,
  facilityId: string,
): Promise<number> {
  for (const a of CHART_OF_ACCOUNTS) {
    await prisma.chartOfAccounts.upsert({
      where: { facilityId_accountCode: { facilityId, accountCode: a.code } },
      update: {
        accountName: a.name,
        accountClass: a.cls,
        accountType: a.type,
        parentAccountCode: a.parent,
        normalBalance: a.normal,
        isSystemAccount: a.system ?? false,
      },
      create: {
        facilityId,
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
  return CHART_OF_ACCOUNTS.length;
}
