/**
 * Suggest the next free account code inside a parent header's block.
 *
 * Codes are permanent: `guard_chart_of_accounts` plus the journal-entry-line
 * FK's ON UPDATE RESTRICT mean a code can never change once the account carries
 * a posting. So this only ever *prefills* an editable field — it must never
 * guess. When it cannot place a code with confidence it returns '' and the user
 * types their own.
 *
 * The block runs from the parent's own code up to (not including) the next
 * header in the same class, which is what keeps a suggestion from landing under
 * the wrong heading — the failure the unique constraint cannot catch.
 *
 * Lives in `shared` rather than beside the Add Account form because the server
 * picks codes by the same rule when it creates a partner's pair of accounts. Two
 * implementations would drift, and a drifted code is permanent.
 */
export interface CodedAccount {
  account_code: string;
  account_class: string;
  account_type: 'HEADER' | 'DETAIL';
  parent_account_code: string | null;
}

const STEP = 10;

/**
 * The range of codes a parent header owns: from its own code up to, but not
 * including, `limit`. Exported so the form can name the range under the code
 * field — the convention is only learnable if it is stated somewhere.
 */
export function codeBlockFor(
  accounts: CodedAccount[],
  parentCode: string,
): { start: number; limit: number } | null {
  const parent = accounts.find(
    (a) => a.account_code === parentCode && a.account_type === 'HEADER',
  );
  if (!parent) return null;

  const start = Number(parent.account_code);
  if (!Number.isFinite(start)) return null;

  // Upper bound: the next header of this class. Without one the block is open
  // ended, so cap it at the end of the class's thousand (6000 -> 6999).
  const nextHeader = accounts
    .filter(
      (a) =>
        a.account_type === 'HEADER' &&
        a.account_class === parent.account_class &&
        Number(a.account_code) > start,
    )
    .map((a) => Number(a.account_code))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];

  return { start, limit: nextHeader ?? (Math.floor(start / 1000) + 1) * 1000 };
}

export function suggestNextCode(accounts: CodedAccount[], parentCode: string): string {
  const block = codeBlockFor(accounts, parentCode);
  if (!block) return '';
  const { start, limit } = block;

  const taken = new Set(accounts.map((a) => Number(a.account_code)));

  // Prefer the round slot after the highest child already in the block, then
  // fall back to the first free slot — which is what fills a gap left by an
  // inserted account (1025) rather than skipping past it.
  const childCodes = accounts
    .filter((a) => a.parent_account_code === parentCode)
    .map((a) => Number(a.account_code))
    .filter((n) => Number.isFinite(n) && n > start && n < limit);

  const afterLast =
    childCodes.length > 0
      ? (Math.floor(Math.max(...childCodes) / STEP) + 1) * STEP
      : start + STEP;

  for (const candidate of [afterLast, ...range(start + STEP, limit, STEP)]) {
    if (candidate > start && candidate < limit && !taken.has(candidate)) {
      return String(candidate);
    }
  }
  return '';
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let n = from; n < to; n += step) out.push(n);
  return out;
}
