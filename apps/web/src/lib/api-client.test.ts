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
