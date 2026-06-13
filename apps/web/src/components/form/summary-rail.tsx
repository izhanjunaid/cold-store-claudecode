import { cn } from '@/lib/utils';

interface SummaryRailProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Sticky right-hand rail for live computed values on long forms
 * (variance %, chamber fill, totals). Presentational only — the parent
 * computes values via useWatch and passes SummaryItem children.
 */
export function SummaryRail({ title = 'Summary', children, className }: SummaryRailProps) {
  return (
    <aside className={cn('lg:sticky lg:top-20', className)}>
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
        <dl className="space-y-2.5">{children}</dl>
      </div>
    </aside>
  );
}

interface SummaryItemProps {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  hint?: string;
}

const TONE_CLASS: Record<NonNullable<SummaryItemProps['tone']>, string> = {
  default: 'text-foreground',
  warning: 'text-amber-600',
  danger: 'text-destructive',
  success: 'text-green-600',
};

export function SummaryItem({ label, value, tone = 'default', hint }: SummaryItemProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-right text-sm font-medium tabular-nums', TONE_CLASS[tone])}>
        {value}
        {hint && <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}
