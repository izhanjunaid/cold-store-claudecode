'use client';

import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
import { apiClientList, type PaginatedResult } from '@/lib/api-client';

/**
 * Server-paginated list fetch. Builds the query string from `params`
 * (skipping empty values) and keeps previous data while a new page loads
 * so tables don't flash empty.
 */
export function useListQuery<T>(
  queryKey: QueryKey,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<PaginatedResult<T>>({
    queryKey,
    queryFn: () => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') search.set(key, String(value));
      }
      const qs = search.toString();
      return apiClientList<T>(qs ? `${path}?${qs}` : path);
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
  });
}
