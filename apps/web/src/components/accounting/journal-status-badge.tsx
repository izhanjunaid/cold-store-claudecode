import { StatusBadge } from '@/components/ui/status-badge';

/**
 * The one way an entry's status is shown (docs/25 L-11). A reversed entry stays
 * POSTED — it really happened, and its mirror cancels it — so "reversed" is read
 * from is_reversed, never from the status. The list, the detail page and the
 * peek each used to decide this for themselves and disagreed: the detail page
 * showed POSTED for an entry the list showed as REVERSED.
 */
export function JournalStatusBadge({ entry }: { entry: { posting_status: string; is_reversed: boolean } }) {
  if (entry.is_reversed) return <StatusBadge status="Reversed" tone="danger" />;
  if (entry.posting_status === 'AUTO_DRAFT') return <StatusBadge status="Draft" tone="warning" />;
  return <StatusBadge status="Posted" tone="success" />;
}

/** The same decision as text, for CSV exports. */
export function journalStatusLabel(entry: { posting_status: string; is_reversed: boolean }): string {
  if (entry.is_reversed) return 'Reversed';
  return entry.posting_status === 'AUTO_DRAFT' ? 'Draft' : 'Posted';
}
