import { SYSTEM_ACCOUNTS } from '@coldchain/shared';

type LineForRevenue = {
  lineType: string;
  ratePlan?: { revenueAccountCode: string | null } | null;
  serviceCharge?: { revenueAccountCode: string | null } | null;
};

/** Include this on invoice lines whose revenue account is about to be resolved. */
export const REVENUE_LINE_INCLUDE = {
  ratePlan: { select: { revenueAccountCode: true } },
  serviceCharge: { select: { revenueAccountCode: true } },
} as const;

/**
 * The revenue account an invoice line posts to — the one rule JE-01 and every
 * credit note share, so a credit note always reverses exactly the account the
 * invoice credited (docs/25 R-03). Storage: the rate plan's override, else the
 * lot's commodity (its stamped account, never its name — L-28). Service: the
 * catalog entry's account. A late-payment surcharge: 4210.
 */
export function revenueAccountForLine(
  line: LineForRevenue,
  commodity: { revenueAccountCode: string | null },
): string {
  switch (line.lineType) {
    case 'STORAGE': {
      const code = line.ratePlan?.revenueAccountCode ?? commodity.revenueAccountCode;
      // The commodities_default_revenue_account trigger stamps every row; null is a broken database.
      if (!code) throw new Error('Commodity has no revenue account');
      return code;
    }
    case 'SERVICE':
      return line.serviceCharge?.revenueAccountCode ?? SYSTEM_ACCOUNTS.SERVICE_REVENUE_OTHER;
    case 'ADJUSTMENT':
      return SYSTEM_ACCOUNTS.SERVICE_REVENUE_OTHER;
    case 'SURCHARGE':
      return SYSTEM_ACCOUNTS.LATE_PAYMENT_SURCHARGE;
    default:
      throw new Error(`Invoice line type ${line.lineType} does not post revenue`);
  }
}
