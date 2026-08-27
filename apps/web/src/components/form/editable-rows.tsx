'use client';

import { useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isEnterAdvanceTarget } from './entry-sheet';

const ROW_FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not(:disabled)',
  'select:not(:disabled)',
  'button[role="combobox"]:not(:disabled)',
].join(', ');

export function addRowTo<T>(rows: T[], row: T): T[] {
  return [...rows, row];
}

export function removeRowAt<T>(rows: T[], index: number): T[] {
  return rows.filter((_, i) => i !== index);
}

export function updateRowAt<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
}

/** Whether the row at `index` may be removed given the `minRows` floor. */
export function canRemoveRow(rowCount: number, minRows: number): boolean {
  return rowCount > minRows;
}

export interface EditableRowColumn<T> {
  key: string;
  header: string;
  /** CSS grid track for this column, e.g. '2fr' or '120px'. */
  width: string;
  align?: 'left' | 'right';
  render: (row: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
}

export interface EditableRowsProps<T> {
  rows: T[];
  onChange: (rows: T[]) => void;
  columns: EditableRowColumn<T>[];
  /** Factory for a new blank row, used by the Add button and by Enter-to-add-row. */
  newRow: () => T;
  addLabel?: string;
  /** Rows at or below this count cannot be removed (the remove button disables). */
  minRows?: number;
  /** Add button hides once rows.length reaches this. */
  maxRows?: number;
  /** Totals / remaining-counter slot, right-aligned next to the Add button. */
  footer?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Generalizes the array-of-rows + controlled-inputs pattern from
 * rack-allocation-editor.tsx for any line-item editor (journal-entry lines,
 * payroll-run review, rack allocation). CSS grid, not <table> — matches the
 * prior art and avoids table-semantics fights with inputs.
 *
 * Enter on the last field of the last row appends a new row (the ERP
 * line-entry reflex); every other Enter press is left alone so it bubbles
 * to an ancestor <EntrySheet>'s own field-to-field advance unmodified.
 */
export function EditableRows<T>({
  rows,
  onChange,
  columns,
  newRow,
  addLabel = 'Add row',
  minRows = 0,
  maxRows,
  footer,
  disabled,
  className,
}: EditableRowsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusNewRowRef = useRef(false);

  useEffect(() => {
    if (!focusNewRowRef.current) return;
    focusNewRowRef.current = false;
    const rowEls = containerRef.current?.querySelectorAll<HTMLElement>('[data-editable-row]');
    const last = rowEls?.[rowEls.length - 1];
    last?.querySelector<HTMLElement>(ROW_FOCUSABLE_SELECTOR)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const atMax = maxRows != null && rows.length >= maxRows;

  const addRow = (focus: boolean) => {
    if (atMax) return;
    focusNewRowRef.current = focus;
    onChange(addRowTo(rows, newRow()));
  };

  const update = (index: number, patch: Partial<T>) => {
    onChange(updateRowAt(rows, index, patch));
  };

  const remove = (index: number) => {
    onChange(removeRowAt(rows, index));
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (!isEnterAdvanceTarget(target) || index !== rows.length - 1) return;

    const rowEl = target.closest('[data-editable-row]');
    const focusables = rowEl
      ? Array.from(rowEl.querySelectorAll<HTMLElement>(ROW_FOCUSABLE_SELECTOR))
      : [];
    const isLastFieldInRow = focusables[focusables.length - 1] === target;
    if (!isLastFieldInRow || disabled || atMax) return;

    e.preventDefault();
    e.stopPropagation();
    addRow(true);
  };

  const gridTemplateColumns = `${columns.map((c) => c.width).join(' ')} auto`;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-full">
          <div
            className="grid items-center gap-2 border-b bg-muted/40 px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
            style={{ gridTemplateColumns }}
          >
            {columns.map((col) => (
              <span key={col.key} className={col.align === 'right' ? 'text-right' : undefined}>
                {col.header}
              </span>
            ))}
            <span aria-hidden />
          </div>
          <div ref={containerRef}>
            {rows.map((row, index) => (
              <div
                key={index}
                data-editable-row
                onKeyDown={(e) => handleRowKeyDown(e, index)}
                className="grid items-center gap-2 border-b px-2 py-1 last:border-b-0"
                style={{ gridTemplateColumns }}
              >
                {columns.map((col) => (
                  <div key={col.key} className={col.align === 'right' ? 'text-right' : undefined}>
                    {col.render(row, (patch) => update(index, patch), index)}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 justify-self-end"
                  disabled={disabled || !canRemoveRow(rows.length, minRows)}
                  onClick={() => remove(index)}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!atMax && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => addRow(false)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {addLabel}
          </Button>
        )}
        {footer && <div className="ml-auto">{footer}</div>}
      </div>
    </div>
  );
}
