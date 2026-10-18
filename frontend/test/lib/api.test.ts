import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ getIdToken: vi.fn(async () => 'tok') }));

import { ApiError, deleteSource, getPosts, listAdminSources } from '@/lib/api';

const fetchMock = vi.fn();

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('getPosts builds query', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: [] }));
    await getPosts({ cursor: 'c', sourceId: 's', since: '2026-10-10T00:00:00.000Z' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/posts?cursor=c&sourceId=s&since=2026-10-10T00%3A00%3A00.000Z',
    );
  });

  it('admin calls send raw id token', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: [] }));
    await listAdminSources();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/sources');
    expect(init.headers.Authorization).toBe('tok');
  });

  it('delete resolves on 204', async () => {
    fetchMock.mockResolvedValue(reply(204));
    await expect(deleteSource('a b')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/sources/a%20b');
  });

  it('error body becomes ApiError', async () => {
    fetchMock.mockResolvedValue(reply(422, { error: { code: 'NO_FEED_FOUND', message: 'm' } }));
    const err = await getPosts({}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'NO_FEED_FOUND', message: 'm' });
  });
});
