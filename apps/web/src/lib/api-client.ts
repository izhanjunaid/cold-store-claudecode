const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  code: string | null;
  status: number;
  details: unknown;
  constructor(
    message: string,
    opts: { code?: string | null; status: number; details?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? null;
    this.status = opts.status;
    this.details = opts.details;
  }
}

async function apiFetch(path: string, options: ApiOptions = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const facilityId =
    typeof window !== 'undefined' ? localStorage.getItem('facility_id') : null;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new ApiError(data.error?.message || 'Request failed', {
      code: data.error?.code ?? null,
      status: res.status,
      details: data.error,
    });
  }

  return data;
}

export async function apiClient<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const data = await apiFetch(path, options);
  return data.data as T;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number };
}

export async function apiClientList<T>(path: string, options: ApiOptions = {}): Promise<PaginatedResult<T>> {
  const data = await apiFetch(path, options);
  return { data: data.data as T[], meta: data.meta };
}
