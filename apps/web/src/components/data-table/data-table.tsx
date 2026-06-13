'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataTableColumnHeader } from './data-table-column-header';
import { DataTablePagination } from './data-table-pagination';
import { DataTableSkeleton } from './data-table-skeleton';
import { DataTableToolbar } from './data-table-toolbar';
import { buildCsv, downloadCsv, type CsvColumn } from './export-csv';
import type { DataTableColumn, FacetConfig, TableMeta } from './types';
import type { TableSort } from './use-table-state';

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  meta: TableMeta | undefined;
  isLoading: boolean;
  isError?: boolean;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  page: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  perPageOptions?: number[];
  onRowClick?: (row: T) => void;
  getRowId: (row: T) => string;
  toolbar?: {
    searchKey?: string;
    searchPlaceholder?: string;
    facets?: FacetConfig[];
    extra?: React.ReactNode;
  };
  filterValues?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  onResetFilters?: () => void;
  emptyState?: { title: string; description?: string; action?: React.ReactNode };
  /** Enables the CSV export button; exports the current page. */
  csvFilename?: string;
}

export function DataTable<T>({
  columns,
  data,
  meta,
  isLoading,
  isError,
  sort,
  onSortChange,
  page,
  perPage,
  onPageChange,
  onPerPageChange,
  perPageOptions,
  onRowClick,
  getRowId,
  toolbar,
  filterValues = {},
  onFilterChange,
  onResetFilters,
  emptyState,
  csvFilename,
}: DataTableProps<T>) {
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const col of columns) if (col.defaultHidden) initial[col.id] = true;
    return initial;
  });

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hidden[c.id]),
    [columns, hidden],
  );

  const handleExport = useMemo(() => {
    if (!csvFilename) return undefined;
    return () => {
      const csvColumns: CsvColumn<T>[] = visibleColumns.map((col) => ({
        header: col.header,
        value: col.csv ? col.csv : (row: T) => textFallback(col, row),
      }));
      downloadCsv(csvFilename, buildCsv(data, csvColumns));
    };
  }, [csvFilename, visibleColumns, data]);

  const colCount = visibleColumns.length;

  return (
    <div className="space-y-3">
      {toolbar && onFilterChange && onResetFilters && (
        <DataTableToolbar
          searchKey={toolbar.searchKey}
          searchPlaceholder={toolbar.searchPlaceholder}
          searchValue={toolbar.searchKey ? (filterValues[toolbar.searchKey] ?? '') : ''}
          onSearchChange={(v) => toolbar.searchKey && onFilterChange(toolbar.searchKey, v)}
          facets={toolbar.facets}
          filterValues={filterValues}
          onFilterChange={onFilterChange}
          onResetFilters={onResetFilters}
          columns={columns}
          hidden={hidden}
          onToggleColumn={(id, visible) =>
            setHidden((prev) => ({ ...prev, [id]: !visible }))
          }
          onExport={handleExport}
          extra={toolbar.extra}
        />
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="hover:bg-transparent">
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    'h-9 whitespace-nowrap text-xs',
                    (col.align === 'right' || col.numeric) && 'text-right',
                    col.className,
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  scope="col"
                >
                  <DataTableColumnHeader
                    title={col.header}
                    sortId={col.sortId}
                    sort={sort}
                    onSort={onSortChange}
                    align={col.align === 'right' || col.numeric ? 'right' : 'left'}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <DataTableSkeleton columns={colCount} rows={Math.min(perPage, 10)} />
            ) : isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-32 text-center text-muted-foreground">
                  Failed to load data. Please try again.
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-1.5 py-6">
                    <p className="text-sm font-medium text-foreground">
                      {emptyState?.title ?? 'No records found'}
                    </p>
                    {emptyState?.description && (
                      <p className="text-sm text-muted-foreground">{emptyState.description}</p>
                    )}
                    {emptyState?.action && <div className="mt-2">{emptyState.action}</div>}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {visibleColumns.map((col) => (
                    <TableCell
                      key={col.id}
                      className={cn(
                        'py-1.5 text-[13px]',
                        (col.align === 'right' || col.numeric) && 'text-right',
                        col.numeric && 'tabular-nums',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {meta && (
        <DataTablePagination
          page={page}
          perPage={perPage}
          total={meta.total}
          onPageChange={onPageChange}
          onPerPageChange={onPerPageChange}
          perPageOptions={perPageOptions}
        />
      )}
    </div>
  );
}

function textFallback<T>(col: DataTableColumn<T>, row: T): string {
  const node = col.cell(row);
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}
