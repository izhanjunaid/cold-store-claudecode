/**
 * Tax the facility withholds on payments it makes (Income Tax Ordinance 2001).
 *
 * The facility is a withholding agent. 2070 already existed but carries s.149
 * salary withholding only; there was nothing for services or rent, so tax
 * deducted from a supplier was either not deducted at all or vanished into
 * the payment. The two sections stay in separate accounts because the s.165
 * statement reports by section.
 */
export const WITHHOLDING_ACCOUNTS = {
  S153: '2071', // Payments for goods, services and contracts
  S155: '2072', // Rent of immovable property
} as const;

export type WithholdingSection = keyof typeof WITHHOLDING_ACCOUNTS;

export const WITHHOLDING_LABELS: Record<string, string> = {
  S149: 'Salary (s.149)',
  S153: 'Goods, services & contracts (s.153)',
  S155: 'Rent (s.155)',
};

/** Every account that holds tax withheld from someone else, by section. */
export const WITHHOLDING_ACCOUNT_BY_SECTION: Record<string, string> = {
  S149: '2070',
  ...WITHHOLDING_ACCOUNTS,
};
