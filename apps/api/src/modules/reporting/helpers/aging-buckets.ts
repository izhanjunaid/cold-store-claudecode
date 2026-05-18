export type AgingBucketKey = 'b_0_30' | 'b_31_60' | 'b_61_90' | 'b_90_plus';

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageInDays(asOfDate: Date, invoiceDate: Date): number {
  const ms = asOfDate.getTime() - invoiceDate.getTime();
  const days = Math.floor(ms / DAY_MS);
  return Math.max(0, days);
}

export function bucketFor(asOfDate: Date, invoiceDate: Date): AgingBucketKey {
  const days = ageInDays(asOfDate, invoiceDate);
  if (days <= 30) return 'b_0_30';
  if (days <= 60) return 'b_31_60';
  if (days <= 90) return 'b_61_90';
  return 'b_90_plus';
}

export function emptyBuckets() {
  return { b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, total_pkr: 0 };
}
