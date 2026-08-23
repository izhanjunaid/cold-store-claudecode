'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';

/**
 * Opening balances are a one-shot, human-driven step that nothing in the
 * product ever asked for — docs/20_audit_backlog.md records exactly that:
 * "no fixture, no provisioning path and no onboarding step invokes it".
 *
 * The consequence is not a crash, which is why it went unnoticed: a facility
 * that skipped the step gets statements that are arithmetically correct over
 * incomplete data. Everything the business did before go-live is simply
 * absent. An accountant reading those statements concludes the software is
 * wrong, and they are right to.
 *
 * So say it, in both places it matters: on the dashboard until the step is
 * done, and on the face of every statement that would otherwise be read as
 * complete.
 *
 * Plain useEffect rather than react-query on purpose. This renders on the
 * statement pages, which have no QueryClientProvider — reaching for useQuery
 * makes the component throw wherever a provider happens to be absent, and it
 * buys nothing for a single boolean fetched once per mount.
 */
type Status = { entered: boolean; as_of_date: string | null };

const BAND =
  'mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300';

export function OpeningBalanceNotice({ context }: { context: 'dashboard' | 'statement' }) {
  // The status endpoint is gated on accounting.view; the dashboard is not, so
  // without this an operator would 403 on every page load.
  const canView = useCan('accounting.view');
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    apiClient('/v1/accounting/opening-balances')
      .then((data) => {
        if (!cancelled) setStatus(data as Status);
      })
      // Stay silent on failure: a notice that cannot read its own status must
      // not imply anything about the books in either direction.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canView]);

  if (!canView || !status || status.entered) return null;

  if (context === 'statement') {
    return (
      <p className={BAND}>
        Opening balances have not been entered, so these figures cover only what has been
        recorded in this system — not the balances the business carried in at go-live.{' '}
        <Link href="/accounting/opening-balances" className="underline underline-offset-2">
          Enter opening balances
        </Link>
        .
      </p>
    );
  }

  return (
    <p className={BAND}>
      <strong>Opening balances are not entered yet.</strong> Until they are, the trial balance,
      profit &amp; loss and balance sheet describe only activity recorded here — party balances,
      cash and bank brought over from your paper registers are missing.{' '}
      <Link href="/accounting/opening-balances" className="underline underline-offset-2">
        Enter them now
      </Link>{' '}
      — it is one balanced entry, done once.
    </p>
  );
}
