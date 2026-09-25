/**
 * The account registry: every account the posting engine writes to by itself, named by
 * its role. No other file in the codebase may hold an account-code literal (CI gate —
 * see scripts/check-account-literals.mjs); the seed in packages/db is the one other
 * place codes are spelled out, because it is what creates them.
 *
 * A code here is safe to hard-wire because it cannot change underneath us: once an
 * account carries a posting, `guard_chart_of_accounts` freezes its code, class, type,
 * parent and normal balance. Owners may rename these accounts; they cannot renumber
 * them.
 *
 * What does NOT live here: any property an owner-created account can also have. "Is
 * this cash?", "may a person post to it by hand?", "must every line name a party?" are
 * columns on the chart row (`is_cash_equivalent`, `allow_manual_posting`,
 * `requires_party`), because a second bank account the owner adds must behave exactly
 * like 1020 — a list of codes can never know about it.
 */
export const SYSTEM_ACCOUNTS = {
  // Cash & bank (1000)
  CASH_ON_HAND: '1010',
  BANK_MAIN: '1020',
  CHEQUES_IN_HAND: '1025',
  MOBILE_WALLET: '1030',

  // Trade receivables (1100) — the defaults a party's control account is stamped from
  AR_FARMERS: '1110',
  AR_TRADERS: '1120',
  AR_ARHTIS: '1130',
  PESHGI_LOANS: '1140',
  AR_OTHER: '1150',

  // Other current assets (1200)
  SUPPLIER_ADVANCES: '1210',
  EMPLOYEE_ADVANCES: '1230',
  TAX_WITHHELD_RECEIVABLE: '1240',
  ACCRUED_STORAGE_REVENUE: '1250',
  INPUT_SALES_TAX: '1260',

  // Fixed assets (1300)
  FA_PLANT: '1310',
  FA_PLANT_ACC_DEP: '1311',
  FA_BUILDING: '1320',
  FA_BUILDING_ACC_DEP: '1321',
  FA_VEHICLES: '1330',
  FA_VEHICLES_ACC_DEP: '1331',
  FA_COMPUTERS: '1340',
  FA_COMPUTERS_ACC_DEP: '1341',
  FA_SOFTWARE: '1360',
  FA_SOFTWARE_ACC_AMORT: '1361',
  FA_ACC_IMPAIRMENT: '1370',
  FA_OTHER: '1380',
  FA_OTHER_ACC_DEP: '1381',

  // Current liabilities (2000)
  CUSTOMER_ADVANCES: '2010',
  GST_OUTPUT: '2020',
  SALARIES_PAYABLE: '2030',
  /** Legacy: every accrued expense voucher credited this before payables existed. Carries its old balance only. */
  UTILITY_BILLS_PAYABLE: '2040',
  TRADE_PAYABLES: '2050',
  EOBI_EMPLOYEE: '2060',
  EOBI_EMPLOYER: '2061',
  WHT_SALARIES: '2070',
  WHT_SUPPLIERS: '2071',
  WHT_RENT: '2072',

  // Long-term liabilities (2100)
  LOAN_FROM_OWNER: '2120',

  // Equity (3000)
  OPENING_BALANCE_EQUITY: '3010',
  RETAINED_EARNINGS: '3020',
  CURRENT_YEAR_RESULT: '3030',
  PARTNERS_CAPITAL: '3100',
  PARTNERS_DRAWINGS: '3200',

  // Revenue (4000)
  STORAGE_REVENUE_OTHER: '4050',
  SERVICE_REVENUE_OTHER: '4150',
  LATE_PAYMENT_SURCHARGE: '4210',
  GAIN_ON_DISPOSAL: '4230',
  DISCOUNTS_ALLOWED: '4910',

  // Cost of service (5000)
  DIRECT_LABOUR: '5030',
  DIRECT_LABOUR_EOBI: '5035',
  DEPRECIATION_PLANT: '5040',

  // Operating expenses (6000)
  SALARIES_OFFICE: '6010',
  SALARIES_OFFICE_EOBI: '6015',
  BAD_DEBTS: '6080',
  MISCELLANEOUS: '6100',
  DEPRECIATION_BUILDING: '6120',
  DEPRECIATION_VEHICLES: '6130',
  AMORTISATION_SOFTWARE: '6140',
  IMPAIRMENT_LOSS: '6160',
  DEPRECIATION_COMPUTERS: '6170',
  DEPRECIATION_OTHER: '6180',
  STAFF_BENEFITS: '6190',

  // Non-operating expenses (6900)
  LOSS_ON_DISPOSAL: '6110',
} as const;

export type SystemAccountRole = keyof typeof SYSTEM_ACCOUNTS;

const A = SYSTEM_ACCOUNTS;

/**
 * The control account a new party is stamped with, by type. Read ONCE, at creation:
 * afterwards the party row's `control_account_code` is the only answer, which is what
 * stops a retyped farmer's invoice debit and payment credit landing in different
 * accounts (docs/25 R-01).
 */
export const DEFAULT_CONTROL_ACCOUNT_BY_PARTY_TYPE: Record<string, string> = {
  FARMER: A.AR_FARMERS,
  TRADER: A.AR_TRADERS,
  ARHTI: A.AR_ARHTIS,
  BUYER: A.AR_OTHER,
  OTHER: A.AR_OTHER,
  SUPPLIER: A.TRADE_PAYABLES,
};

export function defaultControlAccountForPartyType(partyType: string): string {
  const account = DEFAULT_CONTROL_ACCOUNT_BY_PARTY_TYPE[partyType];
  if (!account) throw new Error(`No control account mapping for party type '${partyType}'`);
  return account;
}

/** Every account that is a receivable control account. The aging tie-out sums exactly these. */
export const AR_CONTROL_ACCOUNTS = [A.AR_FARMERS, A.AR_TRADERS, A.AR_ARHTIS, A.AR_OTHER] as const;

/**
 * The accounts the statements compute rather than read. The engine refuses 3030 from
 * every source; 3020 is accepted from opening balances only (docs/25 §2 matrix).
 */
export const DERIVED_EQUITY_ACCOUNTS = [A.RETAINED_EARNINGS, A.CURRENT_YEAR_RESULT] as const;

/**
 * Where a disbursement lands by payment method, when the caller does not choose an
 * account. Only a default: every disbursement is then validated against the chart's
 * `is_cash_equivalent` flag, so an owner's second bank account is as valid as 1020.
 */
export const PAYMENT_METHOD_ASSET_ACCOUNT: Record<string, string> = {
  CASH: A.CASH_ON_HAND,
  CHEQUE: A.BANK_MAIN,
  BANK_TRANSFER: A.BANK_MAIN,
  MOBILE_WALLET: A.MOBILE_WALLET,
};

/** The default "paid from / paid into" account offered when a caller does not choose one. */
export const DEFAULT_BANK_ACCOUNT_CODE: string = A.BANK_MAIN;

/**
 * Payment methods are a closed enum: an unmapped value is a programming error, and a
 * silent fallback would misclassify the posting (audit finding F-10). Fail loudly.
 */
export function assetAccountForPaymentMethod(method: string): string {
  const account = PAYMENT_METHOD_ASSET_ACCOUNT[method];
  if (!account) throw new Error(`No asset account mapping for payment method '${method}'`);
  return account;
}

/**
 * Where a *received* payment lands. A cheque the facility receives can still bounce,
 * so it parks in Cheques in Hand until it clears; a cheque the facility writes is an
 * immediate bank movement, which is why this is separate from the disbursement map.
 */
export function receiptAssetAccountForPaymentMethod(method: string): string {
  if (method === 'CHEQUE') return A.CHEQUES_IN_HAND;
  return assetAccountForPaymentMethod(method);
}

/**
 * Seeded storage-revenue account by commodity name — used only to stamp a commodity's
 * `revenue_account_code` when it is created or backfilled. Posting reads the commodity
 * row, never the name, so renaming a commodity can no longer re-route its revenue
 * (docs/25 L-28).
 */
export const SEEDED_COMMODITY_REVENUE_ACCOUNT: Record<string, string> = {
  POTATO: '4010',
  APPLE: '4020',
  ONION: '4030',
  KINNOW: '4040',
};

export function defaultRevenueAccountForCommodity(name: string | null | undefined): string {
  if (!name) return A.STORAGE_REVENUE_OTHER;
  return SEEDED_COMMODITY_REVENUE_ACCOUNT[name.toUpperCase()] ?? A.STORAGE_REVENUE_OTHER;
}

/** Fixed-asset category → the three accounts an asset of that category posts to. */
export const ASSET_CATEGORY_ACCOUNTS: Record<
  string,
  { asset: string; accumulatedDepreciation: string; depreciationExpense: string }
> = {
  COLD_PLANT: { asset: A.FA_PLANT, accumulatedDepreciation: A.FA_PLANT_ACC_DEP, depreciationExpense: A.DEPRECIATION_PLANT },
  BUILDING: { asset: A.FA_BUILDING, accumulatedDepreciation: A.FA_BUILDING_ACC_DEP, depreciationExpense: A.DEPRECIATION_BUILDING },
  VEHICLE: { asset: A.FA_VEHICLES, accumulatedDepreciation: A.FA_VEHICLES_ACC_DEP, depreciationExpense: A.DEPRECIATION_VEHICLES },
  COMPUTER: { asset: A.FA_COMPUTERS, accumulatedDepreciation: A.FA_COMPUTERS_ACC_DEP, depreciationExpense: A.DEPRECIATION_COMPUTERS },
  OTHER: { asset: A.FA_OTHER, accumulatedDepreciation: A.FA_OTHER_ACC_DEP, depreciationExpense: A.DEPRECIATION_OTHER },
};

/** Every depreciation / amortisation expense account the registry knows — the EBITDA add-back. */
export const DEPRECIATION_EXPENSE_ACCOUNTS = [
  A.DEPRECIATION_PLANT,
  A.DEPRECIATION_BUILDING,
  A.DEPRECIATION_VEHICLES,
  A.AMORTISATION_SOFTWARE,
  A.DEPRECIATION_COMPUTERS,
  A.DEPRECIATION_OTHER,
] as const;
