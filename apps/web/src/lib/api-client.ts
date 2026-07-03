// Empty string => same-origin relative requests (production: web + API share one
// origin behind Caddy). Unset => the dev default below. We use `??` (not `||`) so an
// explicit empty value is preserved instead of falling back to localhost.
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

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

// Single-flight refresh: parallel 401s share one refresh call instead of racing,
// which would revoke each other's rotated refresh tokens.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) return false;
        localStorage.setItem('access_token', data.data.access_token);
        localStorage.setItem('refresh_token', data.data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Session is over (401 and refresh failed): clear tokens, land on /login with context. */
function redirectToLogin() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('facility_id');
  const next = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ expired: '1' });
  if (next && next !== '/' && !next.startsWith('/login')) params.set('next', next);
  window.location.assign(`/login?${params.toString()}`);
}

async function apiFetch(path: string, options: ApiOptions = {}, isRetry = false) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const facilityId =
    typeof window !== 'undefined' ? localStorage.getItem('facility_id') : null;

  // Only declare a JSON content-type when we actually send a body. A body-less
  // request (e.g. DELETE) with `Content-Type: application/json` is rejected by
  // Fastify (FST_ERR_CTP_EMPTY_JSON_BODY) before it reaches the handler.
  const hasBody = options.body !== undefined && options.body !== null;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
      ...options.headers,
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  // Expired/invalid access token: refresh once and retry the original request.
  // Auth endpoints are excluded — a 401 there is a real answer, not a stale token.
  if (
    res.status === 401 &&
    !isRetry &&
    !path.startsWith('/v1/auth/') &&
    typeof window !== 'undefined' &&
    token
  ) {
    const refreshed = await tryRefreshTokens();
    if (refreshed) return apiFetch(path, options, true);
    redirectToLogin();
  }

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
