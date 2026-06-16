/**
 * Accounting number conventions for financial statements:
 *   - negatives in parentheses:  (1,234)
 *   - zero shown as an em dash:   –
 *   - thousands separators, fixed decimals (default 0 dp for statements)
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface FmtOpts {
  /** decimal places (default 0) */
  dp?: number;
}

/** Format a money amount with accounting conventions. */
export function fmtAcct(n: number | null | undefined, opts: FmtOpts = {}): string {
  const dp = opts.dp ?? 0;
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const rounded = Number(n.toFixed(dp));
  if (rounded === 0) return '–';
  const abs = Math.abs(rounded).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return rounded < 0 ? `(${abs})` : abs;
}

/** Format a percentage (already expressed 0–100). */
export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return `${n.toFixed(dp)}%`;
}

export interface Variance {
  abs: number;
  pct: number | null;
  dir: 'up' | 'down' | 'flat';
}

/** Variance of current vs prior (absolute + % of prior magnitude). */
export function variance(current: number, prior: number): Variance {
  const abs = round2(current - prior);
  const pct = prior !== 0 ? round2((abs / Math.abs(prior)) * 100) : null;
  const dir = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
  return { abs, pct, dir };
}

/** "1,234,567" with no decimals — for ratios / counts. */
export function fmtPlain(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Ratio with `x` suffix, e.g. 1.85x. Guards divide-by-zero. */
export function fmtRatio(numerator: number, denominator: number, dp = 2): string {
  if (!denominator) return '–';
  return `${(numerator / denominator).toFixed(dp)}x`;
}
