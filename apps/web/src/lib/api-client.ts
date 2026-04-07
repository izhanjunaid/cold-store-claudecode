const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiClient<T>(path: string, options: ApiOptions = {}): Promise<T> {
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
    throw new Error(data.error?.message || 'Request failed');
  }

  return data.data as T;
}
