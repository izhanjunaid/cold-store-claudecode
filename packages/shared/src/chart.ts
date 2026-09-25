/**
 * Chart-of-accounts rules shared by the API (enforcement) and the web (forms, labels).
 * They were written three times — coa.service.ts, gl.service.ts and the Chart of
 * Accounts page — and the labels had already drifted apart (docs/25 L-33).
 */

export const ACCOUNT_CLASSES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SERVICE', 'EXPENSE'] as const;
export type AccountClassName = (typeof ACCOUNT_CLASSES)[number];

/** Every class's codes start with its digit. Required, not advisory (docs/25 L-31). */
export const CLASS_CODE_PREFIX: Record<AccountClassName, string> = {
  ASSET: '1',
  LIABILITY: '2',
  EQUITY: '3',
  REVENUE: '4',
  COST_OF_SERVICE: '5',
  EXPENSE: '6',
};

/**
 * The statement sections a HEADER of each class may roll its children into. EQUITY
 * has none: equity is presented by owner and by role, not by header section.
 */
export const CLASS_SECTIONS: Record<AccountClassName, readonly string[]> = {
  ASSET: ['CURRENT_ASSET', 'NON_CURRENT_ASSET'],
  LIABILITY: ['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'],
  EQUITY: [],
  REVENUE: ['REVENUE', 'CONTRA_REVENUE', 'OTHER_INCOME'],
  COST_OF_SERVICE: ['COST_OF_SERVICE'],
  EXPENSE: ['OPERATING_EXPENSE', 'OTHER_EXPENSE'],
};

export const CLASS_LABEL: Record<AccountClassName, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  COST_OF_SERVICE: 'Cost of Service',
  EXPENSE: 'Expenses',
};

export const SECTION_LABEL: Record<string, string> = {
  CURRENT_ASSET: 'Current Assets',
  NON_CURRENT_ASSET: 'Non-current Assets',
  CURRENT_LIABILITY: 'Current Liabilities',
  NON_CURRENT_LIABILITY: 'Non-current Liabilities',
  REVENUE: 'Revenue',
  CONTRA_REVENUE: 'Contra Revenue',
  OTHER_INCOME: 'Other Income',
  COST_OF_SERVICE: 'Cost of Service',
  OPERATING_EXPENSE: 'Operating Expenses',
  OTHER_EXPENSE: 'Non-Operating Expenses',
};

export const CASH_FLOW_SECTIONS = ['OPERATING', 'INVESTING', 'FINANCING'] as const;
export type CashFlowSectionName = (typeof CASH_FLOW_SECTIONS)[number];
