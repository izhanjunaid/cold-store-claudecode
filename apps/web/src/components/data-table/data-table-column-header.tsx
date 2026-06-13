'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableSort } from './use-table-state';

interface DataTableColumnHeaderProps {
  title: string;
  /** Sort field id; omit to render a non-sortable header. */
  sortId?: string;
  sort: TableSort | null;
  onSort: (sort: TableSort | null) => void;
  className?: string;
  align?: 'left' | 'right';
}

/**
 * Sortable column header. Cycles ascending → descending → unsorted.
 */
export function DataTableColumnHeader({
  title,
  sortId,
  sort,
  onSort,
  className,
  align = 'left',
}: DataTableColumnHeaderProps) {
  if (!sortId) {
    return <span className={cn(align === 'right' && 'block text-right', className)}>{title}</span>;
  }

  const active = sort?.id === sortId;
  const direction = active ? (sort.desc ? 'desc' : 'asc') : undefined;

  const handleClick = () => {
    if (!active) onSort({ id: sortId, desc: false });
    else if (!sort.desc) onSort({ id: sortId, desc: true });
    else onSort(null);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Sort by ${title}`}
      className={cn(
        'inline-flex items-center gap-1 hover:text-foreground',
        active && 'text-foreground',
        align === 'right' && 'flex-row-reverse',
        className,
      )}
    >
      <span>{title}</span>
      {direction === 'asc' ? (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
      ) : direction === 'desc' ? (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden />
      )}
    </button>
  );
}
