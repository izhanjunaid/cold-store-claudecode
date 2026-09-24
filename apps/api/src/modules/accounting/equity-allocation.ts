/**
 * Whose the period's result is.
 *
 * **Disclosed, never posted.** No closing entry moves profit into a partner's
 * capital account: retained earnings and the current-year result are already
 * computed rather than posted (virtual closing), and a posted appropriation
 * would be double-counted on top of them — and invalidated by any later
 * backdated entry, which is a supported operation here.
 *
 * That has a presentation consequence worth being explicit about. A partner's
 * account balance is what they put in less what they took out; their *share of
 * the result* is an entitlement, not a movement on that account. So the
 * allocation is reported **alongside** the columns rather than folded into them.
 * Fold it in and the statement of changes in equity would say a partner's equity
 * is one figure while the balance sheet — which reads the same accounts — says
 * another, which is precisely the disagreement `equitySnapshot` exists to stop.
 */

export type PartnerShare = {
  partner_id: string;
  partner_name: string;
  capital_account_code: string;
  weight: number;
};

/** A ratio, and the date it takes effect. */
export type RatioWindow = {
  effective_from: string;
  shares: PartnerShare[];
};

/** A stretch of the reporting period over which one ratio (or none) applies. */
export type Slice = {
  from: string;
  to: string;
  /** null before the first ratio was ever agreed — that result stays undivided. */
  ratio: RatioWindow | null;
};

const dayBefore = (iso: string): string =>
  new Date(new Date(`${iso}T00:00:00.000Z`).getTime() - 86400000).toISOString().slice(0, 10);

/**
 * Cut [from, to] at every ratio change inside it.
 *
 * This is the whole reason a ratio carries a date rather than being a single
 * current value: the year a partner is admitted has to split at the old ratio up
 * to the admission date and the new one after it, and doing that by hand is the
 * part people get wrong.
 */
export function sliceByRatio(from: string, to: string, ratios: RatioWindow[]): Slice[] {
  if (to < from) return [];

  const sorted = [...ratios].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  // The ratio in force on `from` is the latest one that started on or before it.
  const opening = sorted.filter((r) => r.effective_from <= from).pop() ?? null;
  const changes = sorted.filter((r) => r.effective_from > from && r.effective_from <= to);

  const slices: Slice[] = [];
  let cursor = from;
  let current = opening;

  for (const change of changes) {
    if (change.effective_from > cursor) {
      slices.push({ from: cursor, to: dayBefore(change.effective_from), ratio: current });
    }
    cursor = change.effective_from;
    current = change;
  }
  slices.push({ from: cursor, to, ratio: current });

  return slices.filter((s) => s.to >= s.from);
}

/**
 * Divide one amount by weight, to the paisa, with the total preserved.
 *
 * Rounding each share independently loses or gains a paisa, and a statement that
 * does not foot is worse than one that is a paisa uneven — so the largest share
 * absorbs the difference. Largest rather than last, because "last" depends on
 * insertion order and would move the discrepancy around between runs.
 */
export function divideByWeight(
  amountPkr: number,
  shares: PartnerShare[],
): { partner_id: string; amount_pkr: number }[] {
  const total = shares.reduce((t, s) => t + s.weight, 0);
  if (total <= 0 || shares.length === 0) return [];

  const parts = shares.map((s) => ({
    partner_id: s.partner_id,
    amount_pkr: Math.round((amountPkr * s.weight) / total * 100) / 100,
    weight: s.weight,
  }));

  const drift = Math.round((amountPkr - parts.reduce((t, p) => t + p.amount_pkr, 0)) * 100) / 100;
  if (drift !== 0) {
    let biggest = 0;
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i]!.weight > parts[biggest]!.weight) biggest = i;
    }
    parts[biggest]!.amount_pkr = Math.round((parts[biggest]!.amount_pkr + drift) * 100) / 100;
  }

  return parts.map(({ partner_id, amount_pkr }) => ({ partner_id, amount_pkr }));
}
