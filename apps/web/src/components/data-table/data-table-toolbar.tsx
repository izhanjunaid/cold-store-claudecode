'use client';

import { useEffect, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTableFacetedFilter } from './data-table-faceted-filter';
import { DataTableViewOptions } from './data-table-view-options';
import type { DataTableColumn, FacetConfig } from './types';

interface DataTableToolbarProps<T> {
  searchKey?: string;
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  facets?: FacetConfig[];
  filterValues: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
  onResetFilters: () => void;
  columns: DataTableColumn<T>[];
  hidden: Record<string, boolean>;
  onToggleColumn: (columnId: string, visible: boolean) => void;
  onExport?: () => void;
  extra?: React.ReactNode;
}

/**
 * Debounced search box + faceted filters + column visibility + CSV export.
 */
export function DataTableToolbar<T>({
  searchKey,
  searchPlaceholder = 'Search…',
  searchValue,
  onSearchChange,
  facets = [],
  filterValues,
  onFilterChange,
  onResetFilters,
  columns,
  hidden,
  onToggleColumn,
  onExport,
  extra,
}: DataTableToolbarProps<T>) {
  const [draft, setDraft] = useState(searchValue);

  // Keep local input in sync if URL state changes externally (e.g. reset).
  useEffect(() => {
    setDraft(searchValue);
  }, [searchValue]);

  // Debounce search → URL state.
  useEffect(() => {
    if (draft === searchValue) return;
    const t = setTimeout(() => onSearchChange(draft), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const hasActiveFilters =
    (searchKey && searchValue !== '') ||
    facets.some((f) => (filterValues[f.key] ?? '') !== '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {searchKey && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-[220px] pl-8"
            aria-label={searchPlaceholder}
          />
        </div>
      )}
      {facets.map((facet) => (
        <DataTableFacetedFilter
          key={facet.key}
          facet={facet}
          value={filterValues[facet.key] ?? ''}
          onChange={(v) => onFilterChange(facet.key, v)}
        />
      ))}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => {
            setDraft('');
            onResetFilters();
          }}
        >
          Reset
          <X className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {extra}
        {onExport && (
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExport}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Export</span>
          </Button>
        )}
        <DataTableViewOptions columns={columns} hidden={hidden} onToggle={onToggleColumn} />
      </div>
    </div>
  );
}
