import { cn } from '@/lib/utils';

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Columns for the field grid (default 2). */
  columns?: 1 | 2 | 3;
}

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
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
    <section className={cn('rounded-lg border bg-card p-5', className)}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={cn('grid gap-4', GRID_COLS[columns])}>{children}</div>
    </section>
  );
}
