import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, apiClientAll } from './api-client';

// A list endpoint caps a page at 100; asking for more is refused outright (the room
// map asked for 200 and showed an empty room).
describe('apiClientAll', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pages through the whole list, never asking for more than a page holds', async () => {
    const all = Array.from({ length: 230 }, (_, i) => ({ id: i }));
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return { ok: true, json: async () => ({ success: true, data: all.slice((page - 1) * 100, page * 100), meta: { page, per_page: 100, total: 230 } }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await apiClientAll<{ id: number }>('/v1/lots?chamber_id=c1&per_page=100');
    expect(rows).toHaveLength(230);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain('per_page=100&page=');
  });
});

describe('apiClient request headers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { ok: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('omits Content-Type when the request has no body (e.g. DELETE)', async () => {
    await apiClient('/v1/service-charges/abc', { method: 'DELETE' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // Empty application/json body makes Fastify reject the request (FST_ERR_CTP_EMPTY_JSON_BODY).
    expect(headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('sets Content-Type and serialises the body when a payload is present', async () => {
    await apiClient('/v1/service-charges', { method: 'POST', body: { name: 'x' } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
  });
});

// Characterization of the sign-in refresh that open-pdf now shares (refreshSession).
describe('an expired access token', () => {
  const ok = { ok: true, status: 200, json: async () => ({ success: true, data: { fine: true } }) };
  beforeEach(() => {
    localStorage.setItem('access_token', 'old');
    localStorage.setItem('refresh_token', 'r1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is refreshed once and the request is sent again', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v1/auth/refresh')) {
        return { ok: true, json: async () => ({ success: true, data: { access_token: 'new', refresh_token: 'r2' } }) };
      }
      return (init?.headers as Record<string, string>)['Authorization'] === 'Bearer new'
        ? ok
        : { ok: false, status: 401, json: async () => ({ success: false, error: { message: 'expired' } }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient('/v1/lots')).resolves.toEqual({ fine: true });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/lots'))).toHaveLength(2);
    expect(localStorage.getItem('access_token')).toBe('new');
  });

  it('a refresh that fails ends the session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom cannot navigate to /login
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) =>
        String(url).endsWith('/v1/auth/refresh')
          ? { ok: false, json: async () => ({ success: false }) }
          : { ok: false, status: 401, json: async () => ({ success: false, error: { message: 'expired' } }) },
      ),
    );

    await expect(apiClient('/v1/lots')).rejects.toThrow('expired');
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});
