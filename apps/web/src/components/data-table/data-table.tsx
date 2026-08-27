'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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

/**
 * Row height per density mode, pinned on `<tr>` rather than left to padding
 * + inherited line-height so the number in docs/24_ui_density_spec.md is
 * actually what renders. `<tr>` height is a floor in table layout — content
 * taller than it still expands the row — so compact-mode cells must stay
 * single-line (see `col.truncate`) and compact-row actions must use
 * Button size="sm" (h-7); a default/icon button (h-8) forces the row to 32px.
 */
const ROW_HEIGHT: Record<'compact' | 'comfortable', string> = {
  compact: 'h-7',
  comfortable: 'h-9',
};
const CELL_PAD_Y: Record<'compact' | 'comfortable', string> = {
  compact: 'py-1',
  comfortable: 'py-2',
};

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
  /** Row height mode — see ROW_HEIGHT above. Default 'compact'. */
  density?: 'compact' | 'comfortable';
  /** Renders a chevron column; toggling it shows this beneath the row. */
  renderExpanded?: (row: T) => React.ReactNode;
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
  density = 'compact',
  renderExpanded,
}: DataTableProps<T>) {
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const col of columns) if (col.defaultHidden) initial[col.id] = true;
    return initial;
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

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

  const colCount = visibleColumns.length + (renderExpanded ? 1 : 0);
  const footerColumns = visibleColumns.filter((c) => c.footer);
  const rowHeight = ROW_HEIGHT[density];
  const cellPadY = CELL_PAD_Y[density];

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            <TableRow className="h-8 hover:bg-transparent">
              {renderExpanded && <TableHead className="w-8" scope="col" aria-hidden />}
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    'whitespace-nowrap text-xs',
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
              data.map((row) => {
                const id = getRowId(row);
                const isExpanded = expanded.has(id);
                return (
                  <Fragment key={id}>
                    <TableRow
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(rowHeight, onRowClick && 'cursor-pointer')}
                    >
                      {renderExpanded && (
                        <TableCell className={cellPadY}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(id);
                            }}
                            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                            aria-expanded={isExpanded}
                            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
                          >
                            <ChevronRight
                              className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                              aria-hidden
                            />
                          </button>
                        </TableCell>
                      )}
                      {visibleColumns.map((col) => (
                        <TableCell
                          key={col.id}
                          className={cn(
                            cellPadY,
                            'text-sm',
                            (col.align === 'right' || col.numeric) && 'text-right',
                            col.numeric && 'tabular-nums',
                            col.truncate && 'truncate',
                            col.className,
                          )}
                          style={col.truncate && col.width ? { maxWidth: col.width } : undefined}
                          title={col.truncate ? textFallback(col, row) || undefined : undefined}
                        >
                          {col.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                    {renderExpanded && isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={colCount} className="bg-muted/30 p-3">
                          {renderExpanded(row)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
          {footerColumns.length > 0 && (
            <TableFooter className="sticky bottom-0 z-10">
              <TableRow className="hover:bg-transparent">
                {renderExpanded && <TableCell />}
                {visibleColumns.map((col) => (
                  <TableCell
                    key={col.id}
                    className={cn(
                      'text-sm tabular-nums',
                      (col.align === 'right' || col.numeric) && 'text-right',
                    )}
                  >
                    {col.footer ? col.footer(data) : null}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
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
