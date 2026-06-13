'use client';

import { useCallback, useMemo } from 'react';
import { parseAsString, useQueryStates } from 'nuqs';

export interface TableSort {
  id: string;
  desc: boolean;
}

export interface TableUrlState {
  page: number;
  perPage: number;
  sort: TableSort | null;
  filters: Record<string, string>;
}

export interface UseTableStateResult {
  state: TableUrlState;
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (sort: TableSort | null) => void;
  /** Setting a filter resets to page 1. */
  setFilter: (key: string, value: string) => void;
  resetFilters: () => void;
  /**
   * Params ready for useListQuery: page, per_page, sort_by/sort_dir (when
   * sorted) and every non-empty filter.
   */
  queryParams: Record<string, string | number | undefined>;
}

function parseSort(raw: string): TableSort | null {
  if (!raw) return null;
  const [id, dir] = raw.split(':');
  if (!id) return null;
  return { id, desc: dir === 'desc' };
}

/**
 * URL-synced table state (page, per_page, sort, named filters) so list
 * screens are bookmarkable and survive refresh. All values are stored as
 * strings (homogeneous parser map) and coerced where needed.
 */
export function useTableState(
  filterKeys: readonly string[],
  options?: { defaultPerPage?: number },
): UseTableStateResult {
  const defaultPerPage = options?.defaultPerPage ?? 20;
  const filterKeysSignature = JSON.stringify(filterKeys);

  const parsers = useMemo(() => {
    const base: Record<string, ReturnType<typeof parseAsString.withDefault>> = {
      page: parseAsString.withDefault('1'),
      per_page: parseAsString.withDefault(String(defaultPerPage)),
      sort: parseAsString.withDefault(''),
    };
    for (const key of filterKeys) {
      base[key] = parseAsString.withDefault('');
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPerPage, filterKeysSignature]);

  const [values, setValues] = useQueryStates(parsers, { history: 'replace' });

  const state = useMemo<TableUrlState>(() => {
    const filters: Record<string, string> = {};
    for (const key of filterKeys) {
      const v = values[key];
      if (v) filters[key] = v;
    }
    return {
      page: Number(values['page']) || 1,
      perPage: Number(values['per_page']) || defaultPerPage,
      sort: parseSort(values['sort'] ?? ''),
      filters,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, defaultPerPage, filterKeysSignature]);

  const setPage = useCallback(
    (page: number) => void setValues({ page: String(page) }),
    [setValues],
  );

  const setPerPage = useCallback(
    (perPage: number) => void setValues({ per_page: String(perPage), page: '1' }),
    [setValues],
  );

  const setSort = useCallback(
    (sort: TableSort | null) =>
      void setValues({ sort: sort ? `${sort.id}:${sort.desc ? 'desc' : 'asc'}` : '' }),
    [setValues],
  );

  const setFilter = useCallback(
    (key: string, value: string) => void setValues({ [key]: value, page: '1' }),
    [setValues],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string> = { page: '1' };
    for (const key of filterKeys) cleared[key] = '';
    void setValues(cleared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setValues, filterKeysSignature]);

  const queryParams = useMemo<Record<string, string | number | undefined>>(() => {
    const params: Record<string, string | number | undefined> = {
      page: state.page,
      per_page: state.perPage,
      ...state.filters,
    };
    if (state.sort) {
      params['sort_by'] = state.sort.id;
      params['sort_dir'] = state.sort.desc ? 'desc' : 'asc';
    }
    return params;
  }, [state]);

  return { state, setPage, setPerPage, setSort, setFilter, resetFilters, queryParams };
}
