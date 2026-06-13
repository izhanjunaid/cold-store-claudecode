import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-600/20',
  success: 'bg-green-100 text-green-800 ring-green-600/20',
  warning: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  danger: 'bg-red-100 text-red-800 ring-red-600/20',
  info: 'bg-blue-100 text-blue-800 ring-blue-600/20',
  muted: 'bg-slate-100 text-slate-500 ring-slate-500/20',
};

/**
 * Per-domain status → tone maps. The badge always renders the status text
 * (never colour alone) so it stays accessible to colour-blind users.
 */
const STATUS_TONES: Record<string, Tone> = {
  // Lots
  ACTIVE: 'success',
  CLOSED: 'muted',
  SUSPENDED: 'warning',
  // Invoices / outbound
  DRAFT: 'neutral',
  FINALIZED: 'info',
  PAID: 'success',
  PARTIALLY_PAID: 'warning',
  PARTIAL: 'warning',
  OVERDUE: 'danger',
  VOID: 'muted',
  CANCELLED: 'muted',
  PENDING: 'warning',
  DISPATCHED: 'success',
  // Payments
  CLEARED: 'success',
  DISHONOURED: 'danger',
  ALLOCATED: 'success',
  UNALLOCATED: 'warning',
  // Loans / peshgi
  RECOVERED: 'success',
  WRITTEN_OFF: 'muted',
  // Gate passes
  INSIDE: 'info',
  CLEARED_OUT: 'muted',
  BLOCKED: 'danger',
  // Generic
  INACTIVE: 'muted',
  OPEN: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
};

function toneFor(status: string, override?: Tone): Tone {
  if (override) return override;
  return STATUS_TONES[status.toUpperCase()] ?? 'neutral';
}

function humanize(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusBadgeProps {
  status: string;
  tone?: Tone;
  className?: string;
  /** Render the raw status string instead of a humanized version. */
  raw?: boolean;
}

export function StatusBadge({ status, tone, className, raw }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[toneFor(status, tone)],
        className,
      )}
    >
      {raw ? status : humanize(status)}
    </span>
  );
}
