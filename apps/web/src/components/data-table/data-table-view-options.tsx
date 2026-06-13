'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DataTableColumn } from './types';

interface DataTableViewOptionsProps<T> {
  columns: DataTableColumn<T>[];
  hidden: Record<string, boolean>;
  onToggle: (columnId: string, visible: boolean) => void;
}

export function DataTableViewOptions<T>({
  columns,
  hidden,
  onToggle,
}: DataTableViewOptionsProps<T>) {
  const toggleable = columns.filter((c) => c.enableHiding !== false);
  if (toggleable.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {toggleable.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden[column.id]}
            onCheckedChange={(checked) => onToggle(column.id, !!checked)}
            onSelect={(e) => e.preventDefault()}
          >
            {column.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
