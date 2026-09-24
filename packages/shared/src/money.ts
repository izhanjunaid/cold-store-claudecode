/**
 * Money arithmetic shared by the API, the web client and the PDF templates.
 *
 * Amounts are PKR with two decimal places. Every aggregate is rounded to the paisa at
 * the point it is stored or compared — never mid-sum — and two amounts are equal when
 * they differ by less than half a paisa. There used to be ~39 private copies of
 * `round2` and two different "balanced" tolerances (0.005 on the trial balance, 0.01
 * on the balance sheet), so the same ledger could be balanced on one statement and
 * not on the other (docs/25 L-16).
 */

/** Half a paisa: the largest difference that is still "the same amount". */
export const MONEY_EPSILON = 0.005;

/** Round to the paisa. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when two amounts are the same to the paisa. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < MONEY_EPSILON;
}

/** Sum then round once. */
export function sumMoney(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return round2(total);
}
