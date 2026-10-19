import type { APIGatewayProxyEvent } from 'aws-lambda';
import { route, type ApiDeps } from '../../src/api/router';
import { decodeCursor } from '../../src/lib/cursor';
import type { Post, Source } from '../../src/lib/types';

interface Opts {
  body?: string;
  query?: Record<string, string>;
  claims?: Record<string, unknown>;
}

function ev(method: string, path: string, o: Opts = {}): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    body: o.body ?? null,
    queryStringParameters: o.query ?? null,
    requestContext: { authorizer: o.claims ? { claims: o.claims } : undefined },
  } as unknown as APIGatewayProxyEvent;
}

const owner = { email: 'Owner@Example.com', email_verified: 'true' };
const src = (over: Partial<Source> = {}): Source => ({
  sourceId: 'S1',
  name: 'Blog',
  siteUrl: 'https://b.example',
  feedUrl: 'https://b.example/feed',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const post: Post = {
  postId: 'p',
  url: 'https://b.example/p',
  title: 'T',
  publishedAt: '2026-01-01T00:00:00.000Z',
  sourceId: 'S1',
  sourceName: 'Blog',
  feedKey: 'ALL',
  crawledAt: '2026-01-02T00:00:00.000Z',
  expiresAt: 123,
};
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed Title</title><link>https://b.example/</link><item><title>A</title><link>https://b.example/a</link></item></channel></rss>`;

function mk() {
  const calls: string[] = [];
  const sources = {
    list: jest.fn(async () => [src(), src({ sourceId: 'S2', enabled: false, iconUrl: 'i' })]),
    get: jest.fn(async (id: string) => (id === 'S1' ? src() : undefined)),
    findByFeedUrl: jest.fn(async () => undefined as Source | undefined),
    create: jest.fn(
      async (i: { name: string; siteUrl: string; feedUrl: string; iconUrl?: string }) =>
        src({ ...i, sourceId: 'NEW' }),
    ),
    update: jest.fn(async (id: string) => (id === 'S1' ? src() : undefined)),
    remove: jest.fn(async () => {
      calls.push('remove');
      return true;
    }),
  };
  const posts = {
    listPage: jest.fn(async (): Promise<{ items: Post[]; nextCursor?: string }> => ({
      items: [post],
      nextCursor: 'n',
    })),
    deleteBySource: jest.fn(async () => {
      calls.push('deleteBySource');
      return 1;
    }),
  };
  const settings = {
    get: jest.fn(async () => ({ postsPerSource: 5, crawlHours: [7], retentionDays: 90 })),
    put: jest.fn(
      async (v: { postsPerSource: number; crawlHours: number[]; retentionDays: number }) => ({
        ...v,
        updatedAt: '2026-10-18T00:00:00.000Z',
      }),
    ),
  };
  const deps = {
    sources,
    posts,
    settings,
    fetchText: jest.fn(async (url: string) => ({
      status: 200,
      url,
      contentType: 'application/rss+xml',
      body: RSS,
    })),
    invokeCrawl: jest.fn(async () => undefined),
    allowedEmail: 'owner@example.com',
  };
  return {
    deps: deps as unknown as ApiDeps,
    sources,
    posts,
    settings,
    fetchText: deps.fetchText,
    calls,
    invokeCrawl: deps.invokeCrawl,
  };
}

const parse = (r: { body: string }) => JSON.parse(r.body);

describe('public routes', () => {
  test('GET /posts strips internal fields and clamps limit', async () => {
    const m = mk();
    const r = await route(ev('GET', '/posts', { query: { limit: '500', sourceId: 'S1' } }), m.deps);
    expect(r.statusCode).toBe(200);
    expect(r.headers?.['Cache-Control']).toBe('no-store');
    expect(m.posts.listPage).toHaveBeenCalledWith({ limit: 50, sourceId: 'S1' });
    const body = parse(r);
    expect(body.nextCursor).toBe('n');
    expect(body.items[0]).not.toHaveProperty('feedKey');
    expect(body.items[0]).not.toHaveProperty('expiresAt');
    expect(body.items[0]).not.toHaveProperty('crawledAt');
    expect(body.items[0].postId).toBe('p');
  });

  test('limit defaults to 30 and floors at 1', async () => {
    const m = mk();
    await route(ev('GET', '/posts'), m.deps);
    expect(m.posts.listPage).toHaveBeenLastCalledWith({ limit: 30 });
    await route(ev('GET', '/posts', { query: { limit: '0' } }), m.deps);
    expect(m.posts.listPage).toHaveBeenLastCalledWith({ limit: 1 });
  });

  test('since is normalised to ISO; garbage gives 400', async () => {
    const m = mk();
    await route(ev('GET', '/posts', { query: { since: '2026-10-11T00:00:00+07:00' } }), m.deps);
    expect(m.posts.listPage).toHaveBeenLastCalledWith({
      limit: 30,
      since: '2026-10-10T17:00:00.000Z',
    });
    const r = await route(ev('GET', '/posts', { query: { since: 'yesterday' } }), m.deps);
    expect(r.statusCode).toBe(400);
    expect(parse(r).error.code).toBe('INVALID_INPUT');
  });

  test('q is split into lower-cased search terms; blank is ignored; too long gives 400', async () => {
    const m = mk();
    await route(ev('GET', '/posts', { query: { q: '  Kubernetes   UPGRADES ' } }), m.deps);
    expect(m.posts.listPage).toHaveBeenLastCalledWith({
      limit: 30,
      search: ['kubernetes', 'upgrades'],
    });
    await route(ev('GET', '/posts', { query: { q: '   ' } }), m.deps);
    expect(m.posts.listPage).toHaveBeenLastCalledWith({ limit: 30 });
    const r = await route(ev('GET', '/posts', { query: { q: 'x'.repeat(101) } }), m.deps);
    expect(r.statusCode).toBe(400);
  });

  test('bad cursor gives 400 INVALID_CURSOR', async () => {
    const m = mk();
    m.posts.listPage.mockImplementation(async (...args: unknown[]) => {
      decodeCursor((args[0] as { cursor: string }).cursor);
      return { items: [] };
    });
    const r = await route(ev('GET', '/posts', { query: { cursor: '!!' } }), m.deps);
    expect(r.statusCode).toBe(400);
    expect(parse(r).error.code).toBe('INVALID_CURSOR');
  });

  test('GET /sources returns enabled sources, subset of fields', async () => {
    const r = await route(ev('GET', '/sources'), mk().deps);
    expect(parse(r)).toEqual({
      items: [{ sourceId: 'S1', name: 'Blog', siteUrl: 'https://b.example' }],
    });
  });

  test('unknown route 404', async () => {
    const r = await route(ev('GET', '/nope'), mk().deps);
    expect(r.statusCode).toBe(404);
    expect(parse(r).error.code).toBe('NOT_FOUND');
  });
});

describe('admin auth', () => {
  test.each([
    ['GET', '/admin/sources'],
    ['POST', '/admin/sources'],
    ['DELETE', '/admin/sources/S1'],
    ['GET', '/admin/unknown'],
  ])('%s %s without claims is 401', async (method, path) => {
    const r = await route(ev(method, path), mk().deps);
    expect(r.statusCode).toBe(401);
    expect(parse(r).error.code).toBe('UNAUTHORIZED');
  });

  test('other verified user is 403 and nothing runs', async () => {
    const m = mk();
    const r = await route(
      ev('DELETE', '/admin/sources/S1', { claims: { email: 'x@y.z', email_verified: 'true' } }),
      m.deps,
    );
    expect(r.statusCode).toBe(403);
    expect(parse(r).error).toEqual({ code: 'FORBIDDEN', message: 'This app is private.' });
    expect(m.sources.get).not.toHaveBeenCalled();
  });

  test('unverified owner email is 403', async () => {
    const r = await route(
      ev('GET', '/admin/sources', {
        claims: { email: 'owner@example.com', email_verified: 'false' },
      }),
      mk().deps,
    );
    expect(r.statusCode).toBe(403);
  });

  test('empty ALLOWED_EMAIL never matches', async () => {
    const m = mk();
    const deps = { ...m.deps, allowedEmail: '' };
    const r = await route(
      ev('GET', '/admin/sources', { claims: { email: '', email_verified: 'true' } }),
      deps,
    );
    expect(r.statusCode).toBe(403);
  });

  test('owner (case-insensitive, boolean verified) passes', async () => {
    const r = await route(
      ev('GET', '/admin/sources', { claims: { email: 'Owner@Example.com', email_verified: true } }),
      mk().deps,
    );
    expect(r.statusCode).toBe(200);
    expect(parse(r).items).toHaveLength(2);
  });

  test('trailing slash does not bypass the check', async () => {
    const r = await route(ev('GET', '/admin/sources/'), mk().deps);
    expect(r.statusCode).toBe(401);
  });

  test.each(['//admin/sources', '/Admin/sources', '/admin%2Fsources'])(
    'path trick %s without claims is 404, never admin data',
    async (path) => {
      const r = await route(ev('GET', path), mk().deps);
      expect(r.statusCode).toBe(404);
    },
  );

  test('/admin exactly without claims is 401', async () => {
    const r = await route(ev('GET', '/admin'), mk().deps);
    expect(r.statusCode).toBe(401);
  });
});

describe('admin routes', () => {
  test('discover rejects ftp url', async () => {
    const r = await route(
      ev('POST', '/admin/sources/discover', { claims: owner, body: '{"url":"ftp://a"}' }),
      mk().deps,
    );
    expect(r.statusCode).toBe(400);
    expect(parse(r).error.code).toBe('INVALID_URL');
  });

  test('discover with nothing found is 422 NO_FEED_FOUND', async () => {
    const m = mk();
    m.fetchText.mockImplementation(async (url: string) => ({
      status: 404,
      url,
      contentType: 'text/html',
      body: 'nope',
    }));
    const r = await route(
      ev('POST', '/admin/sources/discover', { claims: owner, body: '{"url":"https://a.example"}' }),
      m.deps,
    );
    expect(r.statusCode).toBe(422);
    expect(parse(r).error).toEqual({
      code: 'NO_FEED_FOUND',
      message: 'No RSS/Atom feed found at this URL — try pasting the feed URL directly.',
    });
  });

  test('discover success returns candidates', async () => {
    const r = await route(
      ev('POST', '/admin/sources/discover', {
        claims: owner,
        body: '{"url":"https://b.example/feed"}',
      }),
      mk().deps,
    );
    expect(r.statusCode).toBe(200);
    expect(parse(r).candidates).toHaveLength(1);
  });

  test('add source: duplicate is 409', async () => {
    const m = mk();
    m.sources.findByFeedUrl.mockResolvedValue(src());
    const r = await route(
      ev('POST', '/admin/sources', { claims: owner, body: '{"feedUrl":"https://b.example/feed"}' }),
      m.deps,
    );
    expect(r.statusCode).toBe(409);
    expect(parse(r).error.code).toBe('DUPLICATE_SOURCE');
  });

  test('add source: invalid url is 400', async () => {
    const r = await route(
      ev('POST', '/admin/sources', { claims: owner, body: '{"feedUrl":5}' }),
      mk().deps,
    );
    expect(r.statusCode).toBe(400);
    expect(parse(r).error.code).toBe('INVALID_URL');
  });

  test('add source: not a feed is 422', async () => {
    const m = mk();
    m.fetchText.mockImplementation(async (url: string) => ({
      status: 200,
      url,
      contentType: 'text/html',
      body: '<html></html>',
    }));
    const r = await route(
      ev('POST', '/admin/sources', { claims: owner, body: '{"feedUrl":"https://b.example/x"}' }),
      m.deps,
    );
    expect(r.statusCode).toBe(422);
    expect(parse(r).error.code).toBe('NOT_A_FEED');
    expect(m.invokeCrawl).not.toHaveBeenCalled();
  });

  test('add source: success creates, triggers crawl, 201', async () => {
    const m = mk();
    const r = await route(
      ev('POST', '/admin/sources', { claims: owner, body: '{"feedUrl":"https://b.example/feed"}' }),
      m.deps,
    );
    expect(r.statusCode).toBe(201);
    expect(m.fetchText).toHaveBeenCalledWith('https://b.example/feed', { timeoutMs: 8000 });
    expect(m.sources.create).toHaveBeenCalledWith({
      name: 'Feed Title',
      feedUrl: 'https://b.example/feed',
      siteUrl: 'https://b.example/',
    });
    expect(m.invokeCrawl).toHaveBeenCalledWith({ sourceId: 'NEW' });
    expect(parse(r).sourceId).toBe('NEW');
  });

  test('add source: iconUrl is stored; invalid iconUrl is 400', async () => {
    const m = mk();
    const r = await route(
      ev('POST', '/admin/sources', {
        claims: owner,
        body: JSON.stringify({
          feedUrl: 'https://b.example/feed',
          iconUrl: 'https://b.example/i.png',
        }),
      }),
      m.deps,
    );
    expect(r.statusCode).toBe(201);
    expect(m.sources.create.mock.calls[0][0].iconUrl).toBe('https://b.example/i.png');
    const bad = await route(
      ev('POST', '/admin/sources', {
        claims: owner,
        body: JSON.stringify({ feedUrl: 'https://b.example/feed', iconUrl: 'javascript:x' }),
      }),
      mk().deps,
    );
    expect(bad.statusCode).toBe(400);
  });

  test('add source: crawl-trigger failure still returns 201', async () => {
    const m = mk();
    m.invokeCrawl.mockRejectedValueOnce(new Error('boom'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await route(
      ev('POST', '/admin/sources', { claims: owner, body: '{"feedUrl":"https://b.example/feed"}' }),
      m.deps,
    );
    spy.mockRestore();
    expect(r.statusCode).toBe(201);
    expect(parse(r).sourceId).toBe('NEW');
  });

  test('add source: explicit name wins and is capped', async () => {
    const m = mk();
    await route(
      ev('POST', '/admin/sources', {
        claims: owner,
        body: JSON.stringify({ feedUrl: 'https://b.example/feed', name: `  ${'x'.repeat(200)}  ` }),
      }),
      m.deps,
    );
    expect(m.sources.create.mock.calls[0][0].name).toBe('x'.repeat(120));
  });

  test('PATCH missing source is 404; empty name is 400', async () => {
    const m = mk();
    const missing = await route(
      ev('PATCH', '/admin/sources/NOPE', { claims: owner, body: '{"enabled":false}' }),
      m.deps,
    );
    expect(missing.statusCode).toBe(404);
    const bad = await route(
      ev('PATCH', '/admin/sources/S1', { claims: owner, body: '{"name":""}' }),
      m.deps,
    );
    expect(bad.statusCode).toBe(400);
    expect(parse(bad).error.code).toBe('INVALID_INPUT');
    const badType = await route(
      ev('PATCH', '/admin/sources/S1', { claims: owner, body: '{"enabled":"yes"}' }),
      m.deps,
    );
    expect(badType.statusCode).toBe(400);
    const ok = await route(
      ev('PATCH', '/admin/sources/S1', { claims: owner, body: '{"enabled":false}' }),
      m.deps,
    );
    expect(ok.statusCode).toBe(200);
  });

  test('PATCH postsPerSource accepts 1–50 or null, rejects others', async () => {
    const m = mk();
    const patch = (body: string) =>
      route(ev('PATCH', '/admin/sources/S1', { claims: owner, body }), m.deps);
    expect((await patch('{"postsPerSource":3}')).statusCode).toBe(200);
    expect(m.sources.update).toHaveBeenLastCalledWith('S1', { postsPerSource: 3 });
    expect((await patch('{"postsPerSource":null}')).statusCode).toBe(200);
    expect(m.sources.update).toHaveBeenLastCalledWith('S1', { postsPerSource: null });
    for (const bad of ['0', '51', '2.5', '"3"']) {
      const r = await patch(`{"postsPerSource":${bad}}`);
      expect(r.statusCode).toBe(400);
      expect(parse(r).error.code).toBe('INVALID_INPUT');
    }
  });

  test('GET /admin/settings returns settings with timezone; requires owner', async () => {
    const m = mk();
    expect((await route(ev('GET', '/admin/settings'), m.deps)).statusCode).toBe(401);
    const r = await route(ev('GET', '/admin/settings', { claims: owner }), m.deps);
    expect(r.statusCode).toBe(200);
    expect(parse(r)).toEqual({
      postsPerSource: 5,
      crawlHours: [7],
      retentionDays: 90,
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });

  test('PUT /admin/settings validates, dedupes and sorts hours', async () => {
    const m = mk();
    const put = (body: string) =>
      route(ev('PUT', '/admin/settings', { claims: owner, body }), m.deps);
    const r = await put('{"postsPerSource":10,"crawlHours":[13,8,13],"retentionDays":30}');
    expect(r.statusCode).toBe(200);
    expect(m.settings.put).toHaveBeenCalledWith({
      postsPerSource: 10,
      crawlHours: [8, 13],
      retentionDays: 30,
    });
    expect(parse(r).timezone).toBe('Asia/Ho_Chi_Minh');
    expect((await put('{"postsPerSource":10,"crawlHours":[],"retentionDays":0}')).statusCode).toBe(
      200,
    );
    for (const bad of [
      '{"postsPerSource":0,"crawlHours":[8],"retentionDays":30}',
      '{"postsPerSource":10,"crawlHours":[24],"retentionDays":30}',
      '{"postsPerSource":10,"crawlHours":"8","retentionDays":30}',
      '{"postsPerSource":10,"retentionDays":30}',
      '{"postsPerSource":10,"crawlHours":[8]}',
      '{"postsPerSource":10,"crawlHours":[8],"retentionDays":-1}',
      '{"postsPerSource":10,"crawlHours":[8],"retentionDays":366}',
      '{"postsPerSource":10,"crawlHours":[8],"retentionDays":1.5}',
    ]) {
      expect((await put(bad)).statusCode).toBe(400);
    }
    expect(m.settings.put).toHaveBeenCalledTimes(2);
  });

  test('DELETE removes posts before source, 204 empty body', async () => {
    const m = mk();
    const r = await route(ev('DELETE', '/admin/sources/S1', { claims: owner }), m.deps);
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect(m.calls).toEqual(['deleteBySource', 'remove']);
    const missing = await route(ev('DELETE', '/admin/sources/NOPE', { claims: owner }), m.deps);
    expect(missing.statusCode).toBe(404);
  });

  test('POST /admin/crawl is 202', async () => {
    const m = mk();
    const r = await route(ev('POST', '/admin/crawl', { claims: owner }), m.deps);
    expect(r.statusCode).toBe(202);
    expect(parse(r)).toEqual({ status: 'started' });
    expect(m.invokeCrawl).toHaveBeenCalledWith({});
    await route(ev('POST', '/admin/crawl', { claims: owner, body: '{"sourceId":"S1"}' }), m.deps);
    expect(m.invokeCrawl).toHaveBeenLastCalledWith({ sourceId: 'S1' });
  });

  test('invalid JSON is 400', async () => {
    const r = await route(ev('POST', '/admin/sources', { claims: owner, body: '{' }), mk().deps);
    expect(r.statusCode).toBe(400);
    expect(parse(r).error.code).toBe('INVALID_JSON');
  });

  test('unexpected errors are 500 INTERNAL', async () => {
    const m = mk();
    m.sources.list.mockRejectedValue(new Error('boom'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await route(ev('GET', '/admin/sources', { claims: owner }), m.deps);
    spy.mockRestore();
    expect(r.statusCode).toBe(500);
    expect(parse(r).error.code).toBe('INTERNAL');
  });
});
