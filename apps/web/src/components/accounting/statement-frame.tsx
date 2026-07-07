'use client';

import { useFacility } from '@/hooks/use-reference-data';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StatementFrameProps {
  /** Statement title, e.g. "Statement of Financial Position". */
  title: string;
  /** Period line, e.g. "For the year ended 30 June 2026" / "As at …". */
  periodLabel: string;
  /** '', 'PACCI', or 'KATCHI'. */
  bookType?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * The "letterhead" around a financial statement: entity, title, period,
 * currency, basis, and an unaudited tag. Wrap this in a `.print-area`
 * container on the page so only the statement prints.
 */
export function StatementFrame({ title, periodLabel, bookType, children, className }: StatementFrameProps) {
  const { data: facility } = useFacility();

  // An unspecified book means PACCI — the server defaults every report to
  // the official book; KATCHI must be requested explicitly (MANAGER+).
  const basis = bookType === 'KATCHI' ? 'KATCHI — Informal' : 'PACCI — Official';
  const unaudited = bookType === 'KATCHI';
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const locationLine = [facility?.address, facility?.city].filter(Boolean).join(', ');

  return (
    <Card className={cn('overflow-hidden', className)}>
      <header className="border-b px-6 py-5 text-center">
        <div className="text-lg font-bold tracking-tight">{facility?.name ?? 'Facility'}</div>
        {locationLine && <p className="text-xs text-muted-foreground">{locationLine}</p>}
        {facility?.gst_number && <p className="text-xs text-muted-foreground">NTN / GST: {facility.gst_number}</p>}

        <h2 className="mt-3 text-base font-semibold uppercase tracking-wide">{title}</h2>
        <p className="text-sm text-muted-foreground">{periodLabel}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Expressed in Pakistani Rupees (PKR)</p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{basis}</span>
          {unaudited && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Management Accounts — Unaudited
            </span>
          )}
        </div>
      </header>

      <div className="px-6 py-5">{children}</div>

      <footer className="flex items-center justify-between border-t px-6 py-2 text-[10px] text-muted-foreground">
        <span>Generated {generated}</span>
        <span>ColdChain</span>
      </footer>
    </Card>
  );
}

/** Letterhead-shaped placeholder shown while a statement loads. */
export function StatementSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-6 py-5">
        <Skeleton className="mx-auto h-6 w-56" />
        <Skeleton className="mx-auto mt-2 h-4 w-40" />
        <Skeleton className="mx-auto mt-3 h-4 w-64" />
      </div>
      <div className="space-y-2.5 px-6 py-5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </Card>
  );
}
