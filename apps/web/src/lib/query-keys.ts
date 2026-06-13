/**
 * Central query-key factory. Every React Query usage should build its key
 * here so invalidation stays consistent across the app.
 */
export type ListFilters = Record<string, string | number | boolean | undefined>;

export const qk = {
  lots: {
    all: ['lots'] as const,
    list: (filters: ListFilters) => ['lots', 'list', filters] as const,
    detail: (id: string) => ['lots', 'detail', id] as const,
  },
  parties: {
    all: ['parties'] as const,
    list: (filters: ListFilters) => ['parties', 'list', filters] as const,
    detail: (id: string) => ['parties', 'detail', id] as const,
    ledger: (id: string) => ['parties', 'ledger', id] as const,
  },
  invoices: {
    all: ['invoices'] as const,
    list: (filters: ListFilters) => ['invoices', 'list', filters] as const,
    detail: (id: string) => ['invoices', 'detail', id] as const,
  },
  payments: {
    all: ['payments'] as const,
    list: (filters: ListFilters) => ['payments', 'list', filters] as const,
    detail: (id: string) => ['payments', 'detail', id] as const,
  },
  loans: {
    all: ['loans'] as const,
    list: (filters: ListFilters) => ['loans', 'list', filters] as const,
    detail: (id: string) => ['loans', 'detail', id] as const,
  },
  chambers: {
    all: ['chambers'] as const,
    list: (filters: ListFilters) => ['chambers', 'list', filters] as const,
    detail: (id: string) => ['chambers', 'detail', id] as const,
  },
  gatePasses: {
    all: ['gate-passes'] as const,
    list: (filters: ListFilters) => ['gate-passes', 'list', filters] as const,
  },
  accounting: {
    all: ['accounting'] as const,
    list: (scope: string, filters: ListFilters) => ['accounting', scope, filters] as const,
  },
  reports: {
    all: ['reports'] as const,
    report: (name: string, filters: ListFilters) => ['reports', name, filters] as const,
  },
  reference: {
    parties: ['ref', 'parties'] as const,
    commodities: ['ref', 'commodities'] as const,
    varieties: ['ref', 'varieties'] as const,
    chambers: ['ref', 'chambers'] as const,
    ratePlans: ['ref', 'rate-plans'] as const,
  },
  facility: {
    me: ['facility', 'me'] as const,
  },
  dashboard: {
    operational: ['dashboard', 'operational'] as const,
    financial: ['dashboard', 'financial'] as const,
  },
} as const;
