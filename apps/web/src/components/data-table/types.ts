import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  /** Stable id, also used as the column-visibility key. */
  id: string;
  header: string;
  /** Pass to enable server-side sorting on this column (the API sort_by value). */
  sortId?: string;
  align?: 'left' | 'right';
  /** Render numbers with tabular-nums + right alignment. */
  numeric?: boolean;
  cell: (row: T) => ReactNode;
  /** Value used for CSV export; falls back to a best-effort string of `cell`. */
  csv?: (row: T) => unknown;
  /** Hidden by default but toggleable via the view-options menu. */
  defaultHidden?: boolean;
  /** Set false to keep the column out of the visibility toggle (always shown). */
  enableHiding?: boolean;
  className?: string;
  /** Header tooltip / extra width hint. */
  width?: string;
}

export interface FacetOption {
  label: string;
  value: string;
}

export interface FacetConfig {
  /** Filter key in the URL state. */
  key: string;
  label: string;
  options: FacetOption[];
}

export interface TableMeta {
  page: number;
  per_page: number;
  total: number;
}
