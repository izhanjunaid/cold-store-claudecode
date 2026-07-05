import { cn } from '@/lib/utils';

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Columns for the field grid (default 2). */
  columns?: 1 | 2 | 3 | 4;
}

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  // 3/4-up only when the form is genuinely wide: beside the summary rail the
  // form is ~600px at lg, where three columns wrap labels and clip selects.
  3: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
};

/**
 * Titled card section for sectioned single-page forms. Fields lay out in a
 * responsive grid; pass `className="sm:col-span-2"` on a field to span.
 */
export function FormSection({
  title,
  description,
  children,
  className,
  columns = 2,
}: FormSectionProps) {
  return (
    <section className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={cn('grid gap-x-4 gap-y-2.5', GRID_COLS[columns])}>{children}</div>
    </section>
  );
}

/**
 * Sticky footer for create/edit forms: the submit button stays visible
 * however tall the form is — fast data entry never scrolls to find Save.
 * `meta` renders right-aligned live values (EntryChip) beside the actions.
 */
export function FormActions({
  children,
  meta,
  className,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mb-6 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur',
        className,
      )}
    >
      {children}
      {meta && <div className="ml-auto flex flex-wrap items-center gap-2">{meta}</div>}
    </div>
  );
}
