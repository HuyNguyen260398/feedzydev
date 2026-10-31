import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  crawlAll,
  OG_FETCH_BUDGET,
  OG_RETRIES_PER_SOURCE,
  OG_RETRY_BUDGET,
  OG_RETRY_MAX_AGE_DAYS,
  type CrawlDeps,
} from '../../src/crawler/crawl';
import { mapWithConcurrency } from '../../src/lib/pool';
import { FetchError, type FetchText } from '../../src/lib/http';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import { postIdFor } from '../../src/lib/url';
import type { Post, Settings, Source } from '../../src/lib/types';

const feedXml = readFileSync(join(__dirname, '../fixtures/rss2-media.xml'), 'utf8');
const NOW = new Date('2026-10-17T00:00:00Z');

const mkSource = (id: string, enabled = true): Source => ({
  sourceId: id,
  name: `Name ${id}`,
  siteUrl: `https://${id}.io`,
  feedUrl: `https://${id}.io/feed`,
  enabled,
  createdAt: '2026-01-01T00:00:00.000Z',
});

function setup(
  sources: Source[],
  fetchImpl: (url: string) => Promise<{ status: number; body: string; cfMitigated?: string }>,
  existing: string[] = [],
  putResult: (p: Post) => boolean = () => true,
  settings: Settings = { postsPerSource: 50, crawlHours: [7], retentionDays: 90 },
) {
  const saved: Post[] = [];
  const updated: { id: string; url: string }[] = [];
  const recorded: { id: string; r: Record<string, unknown> }[] = [];
  const fetched: string[] = [];
  const purgedBefore: string[] = [];
  const fetchText: FetchText = async (url) => {
    fetched.push(url);
    const r = await fetchImpl(url);
    return { url, contentType: 'text/xml', ...r };
  };
  const deps: CrawlDeps = {
    sources: {
      list: async () => sources,
      get: async (id) => sources.find((s) => s.sourceId === id),
      recordCrawl: async (id, r) => {
        recorded.push({ id, r: { ...r } });
      },
    },
    posts: {
      find: async (id) =>
        existing.includes(id) ? { thumbnailUrl: 'https://img.io/existing.png' } : undefined,
      putIfAbsent: async (p) => {
        const ok = putResult(p);
        if (ok) saved.push(p);
        return ok;
      },
      setThumbnail: async (id, url) => {
        updated.push({ id, url });
      },
      deleteOlderThan: async (cutoff) => {
        purgedBefore.push(cutoff);
        return 0;
      },
    },
    settings: { get: async () => settings },
    fetchText,
    now: () => NOW,
  };
  return { deps, saved, updated, recorded, fetched, purgedBefore };
}

const rssOk = async () => ({ status: 200, body: feedXml });

/** crawlAll for runs that are never skipped. */
async function crawlAllOk(...args: Parameters<typeof crawlAll>) {
  const res = await crawlAll(...args);
  if (!res) throw new Error('crawl unexpectedly skipped');
  return res;
}

describe('mapWithConcurrency', () => {
  it('preserves order and respects limit', async () => {
    let active = 0;
    let max = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(max).toBeLessThanOrEqual(2);
  });
});

describe('crawl', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it('saves new posts and records ok', async () => {
    const { deps, saved, recorded } = setup([mkSource('a')], async (url) =>
      url.endsWith('/feed') ? { status: 200, body: feedXml } : { status: 404, body: '' },
    );
    const res = await crawlAllOk(deps, {});
    expect(res).toEqual([
      {
        sourceId: 'a',
        status: 'ok',
        newCount: 3,
        newest: expect.objectContaining({ sourceId: 'a' }),
      },
    ]);
    expect(saved).toHaveLength(3);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].r).toMatchObject({ status: 'ok', newCount: 3 });
  });

  it('one failing source does not stop others', async () => {
    const { deps, saved, recorded } = setup([mkSource('a'), mkSource('b')], async (url) => {
      if (url.startsWith('https://b.io/feed')) throw new FetchError('TIMEOUT', 'slow');
      return url.endsWith('/feed') ? { status: 200, body: feedXml } : { status: 404, body: '' };
    });
    const res = await crawlAllOk(deps, {});
    expect(res).toHaveLength(2);
    expect(saved.length).toBeGreaterThan(0);
    const b = recorded.find((r) => r.id === 'b');
    expect(b?.r.status).toBe('error');
    expect(String(b?.r.error)).toContain('TIMEOUT');
    expect(res[1]).toMatchObject({ sourceId: 'b', status: 'error', newCount: 0 });
  });

  it('records error on non-2xx and unparseable feed', async () => {
    const s = setup([mkSource('a')], async () => ({ status: 500, body: '' }));
    expect((await crawlAllOk(s.deps, {}))[0].status).toBe('error');
    const g = setup([mkSource('a')], async () => ({ status: 200, body: 'garbage' }));
    expect((await crawlAllOk(g.deps, {}))[0].status).toBe('error');
  });

  it('og:image fallback for new thumbnail-less posts, not posts that already have one', async () => {
    const feed = feedXml.replace(
      '<item><title>No date post',
      '<item><title>nt</title><link>https://blog.example.com/posts/nothumb</link><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate></item><item><title>No date post',
    );
    const existingId = postIdFor('https://blog.example.com/posts/relative');
    const wrapped = setup(
      [mkSource('a')],
      async (url) => {
        if (url === 'https://a.io/feed') return { status: 200, body: feed };
        if (url === 'https://blog.example.com/posts/nothumb') {
          return {
            status: 200,
            body: '<meta property="og:image" content="https://img.io/og.png">',
          };
        }
        return { status: 404, body: '' };
      },
      [existingId],
    );
    await crawlAllOk(wrapped.deps, {});
    expect(wrapped.fetched).not.toContain('https://blog.example.com/posts/relative');
    expect(wrapped.fetched).toContain('https://blog.example.com/posts/nothumb');
    const p = wrapped.saved.find((x) => x.url.endsWith('/nothumb'));
    expect(p?.thumbnailUrl).toBe('https://img.io/og.png');
  });

  it('og budget caps page fetches at 30 across one crawl run', async () => {
    expect(OG_FETCH_BUDGET).toBe(30);
    // 7 sources × 5 posts (the per-source cap) = 35 posts wanting an og:image.
    const sources = Array.from({ length: 7 }, (_, i) => mkSource(`s${i}`));
    const feedFor = (id: string) => {
      const items = Array.from(
        { length: 8 },
        (_, i) =>
          `<item><title>t${i}</title><link>https://p.io/${id}/${i}</link><pubDate>Fri, 16 Oct 2026 10:00:0${i} GMT</pubDate></item>`,
      ).join('');
      return `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
    };
    const { deps, fetched } = setup(
      sources,
      async (url) => {
        const m = /^https:\/\/(s\d)\.io\/feed$/.exec(url);
        return m ? { status: 200, body: feedFor(m[1]) } : { status: 200, body: '<html></html>' };
      },
      [],
      undefined,
      { postsPerSource: 5, crawlHours: [7], retentionDays: 90 },
    );
    const res = await crawlAllOk(deps, {});
    expect(res.map((r) => r.newCount)).toEqual(Array(7).fill(5));
    expect(fetched.filter((u) => u.startsWith('https://p.io/'))).toHaveLength(30);
  });

  describe('og:image page fetches', () => {
    const POSTED = 'Fri, 16 Oct 2026 10:00:00 GMT';
    const item = (id: string, url: string, pubDate = POSTED, extra = '') =>
      `<item><title>${id}</title><link>${url}</link><pubDate>${pubDate}</pubDate>${extra}</item>`;
    const rss = (items: string[]) =>
      `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;
    /** Feed of `n` thumbnail-less posts for a source, at https://p.io/<id>/<i>. */
    const feedOf = (id: string, n: number) =>
      rss(Array.from({ length: n }, (_, i) => item(`t${i}`, `https://p.io/${id}/${i}`)));
    const isPage = (u: string) => u.startsWith('https://p.io/');
    const logged = () => log.mock.calls.map(([line]) => JSON.parse(line as string));
    /** Marks posts as already stored without a thumbnail. */
    const stored = (t: ReturnType<typeof setup>, urls: string[]) => {
      const ids = urls.map(postIdFor);
      t.deps.posts.find = async (id) => (ids.includes(id) ? {} : undefined);
    };
    const OG = '<meta property="og:image" content="https://img.io/og.png">';

    it('logs a failed page fetch with its status and cf-mitigated value', async () => {
      const t = setup([mkSource('a')], async (url) =>
        isPage(url)
          ? { status: 403, body: 'Just a moment...', cfMitigated: 'challenge' }
          : { status: 200, body: feedOf('a', 1) },
      );
      await crawlAllOk(t.deps, {});
      expect(logged()).toContainEqual({
        msg: 'crawl.og_failed',
        sourceId: 'a',
        url: 'https://p.io/a/0',
        status: 403,
        cfMitigated: 'challenge',
      });
      expect(t.saved).toHaveLength(1);
    });

    it('logs a page fetch that throws, and still saves the post', async () => {
      const t = setup([mkSource('a')], async (url) => {
        if (isPage(url)) throw new FetchError('TIMEOUT', 'slow');
        return { status: 200, body: feedOf('a', 1) };
      });
      await crawlAllOk(t.deps, {});
      expect(logged()).toContainEqual({
        msg: 'crawl.og_failed',
        sourceId: 'a',
        url: 'https://p.io/a/0',
        error: 'TIMEOUT: slow',
      });
      expect(t.saved).toHaveLength(1);
    });

    it('does not log a page that loads without an og:image', async () => {
      const t = setup([mkSource('a')], async (url) =>
        isPage(url)
          ? { status: 200, body: '<html></html>' }
          : { status: 200, body: feedOf('a', 1) },
      );
      await crawlAllOk(t.deps, {});
      expect(logged()).toEqual([]);
    });

    it('stops fetching pages for a source after its first challenge', async () => {
      const t = setup([mkSource('a'), mkSource('b')], async (url) => {
        if (url === 'https://a.io/feed') return { status: 200, body: feedOf('a', 4) };
        if (url === 'https://b.io/feed') return { status: 200, body: feedOf('b', 4) };
        return url.includes('/a/')
          ? { status: 403, body: '', cfMitigated: 'challenge' }
          : { status: 200, body: OG };
      });
      await crawlAllOk(t.deps, {});
      expect(t.fetched.filter((u) => u.includes('p.io/a/'))).toHaveLength(1);
      expect(t.fetched.filter((u) => u.includes('p.io/b/'))).toHaveLength(4);
      expect(t.saved).toHaveLength(8);
    });

    it('keeps fetching pages after an ordinary failure', async () => {
      const t = setup([mkSource('a')], async (url) =>
        isPage(url) ? { status: 404, body: '' } : { status: 200, body: feedOf('a', 3) },
      );
      await crawlAllOk(t.deps, {});
      expect(t.fetched.filter(isPage)).toHaveLength(3);
    });

    it('backfills a stored post from its page, without counting it as new', async () => {
      const t = setup([mkSource('a')], async (url) =>
        isPage(url) ? { status: 200, body: OG } : { status: 200, body: feedOf('a', 1) },
      );
      stored(t, ['https://p.io/a/0']);
      const [r] = await crawlAllOk(t.deps, {});
      expect(t.updated).toEqual([
        { id: postIdFor('https://p.io/a/0'), url: 'https://img.io/og.png' },
      ]);
      expect(t.saved).toEqual([]);
      expect(r.newCount).toBe(0);
      expect(r).not.toHaveProperty('newest');
    });

    it('backfills from the feed without fetching the page', async () => {
      const feed = rss([
        item(
          't',
          'https://p.io/a/0',
          POSTED,
          '<enclosure url="https://img.io/f.png" type="image/png"/>',
        ),
      ]);
      const t = setup([mkSource('a')], async () => ({ status: 200, body: feed }));
      stored(t, ['https://p.io/a/0']);
      await crawlAllOk(t.deps, {});
      expect(t.updated).toEqual([
        { id: postIdFor('https://p.io/a/0'), url: 'https://img.io/f.png' },
      ]);
      expect(t.fetched.filter(isPage)).toEqual([]);
    });

    it('leaves a stored post alone when its page still has no image', async () => {
      const t = setup([mkSource('a')], async (url) =>
        isPage(url)
          ? { status: 200, body: '<html></html>' }
          : { status: 200, body: feedOf('a', 1) },
      );
      stored(t, ['https://p.io/a/0']);
      await crawlAllOk(t.deps, {});
      expect(t.updated).toEqual([]);
    });

    it('does not refetch pages of stored posts past the retry window', async () => {
      const age = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toUTCString();
      const feed = rss([
        item('in', 'https://p.io/a/in', age(OG_RETRY_MAX_AGE_DAYS - 1)),
        item('out', 'https://p.io/a/out', age(OG_RETRY_MAX_AGE_DAYS + 1)),
      ]);
      const t = setup([mkSource('a')], async (url) =>
        isPage(url) ? { status: 200, body: OG } : { status: 200, body: feed },
      );
      stored(t, ['https://p.io/a/in', 'https://p.io/a/out']);
      await crawlAllOk(t.deps, {});
      expect(t.fetched.filter(isPage)).toEqual(['https://p.io/a/in']);
    });

    it('caps page retries per source', async () => {
      const n = OG_RETRIES_PER_SOURCE + 2;
      const t = setup([mkSource('a')], async (url) =>
        isPage(url)
          ? { status: 200, body: '<html></html>' }
          : { status: 200, body: feedOf('a', n) },
      );
      stored(
        t,
        Array.from({ length: n }, (_, i) => `https://p.io/a/${i}`),
      );
      await crawlAllOk(t.deps, {});
      expect(t.fetched.filter(isPage)).toHaveLength(OG_RETRIES_PER_SOURCE);
    });

    it('caps page retries per run, leaving the rest of the budget for new posts', async () => {
      // Each source has more stored posts than it may retry, then 6 new posts.
      const perSource = OG_RETRIES_PER_SOURCE + 1;
      const sources = Array.from({ length: 5 }, (_, i) => mkSource(`s${i}`));
      const urlOf = (id: string, i: number) => `https://p.io/${id}/${i}`;
      const feedFor = (id: string) => {
        const at = (i: number) => new Date(Date.parse(POSTED) - i * 60_000).toUTCString();
        return rss(
          Array.from({ length: perSource + 6 }, (_, i) => item(`t${i}`, urlOf(id, i), at(i))),
        );
      };
      const retried = sources.flatMap((s) =>
        Array.from({ length: perSource }, (_, i) => urlOf(s.sourceId, i)),
      );
      const t = setup(sources, async (url) => {
        const m = /^https:\/\/(s\d)\.io\/feed$/.exec(url);
        return m ? { status: 200, body: feedFor(m[1]) } : { status: 200, body: '<html></html>' };
      });
      stored(t, retried);
      await crawlAllOk(t.deps, {});
      const pages = t.fetched.filter(isPage);
      expect(pages.filter((u) => retried.includes(u))).toHaveLength(OG_RETRY_BUDGET);
      expect(pages).toHaveLength(OG_FETCH_BUDGET);
    });

    it('logs a failed backfill and still records the crawl as ok', async () => {
      const t = setup([mkSource('a')], async (url) =>
        isPage(url) ? { status: 200, body: OG } : { status: 200, body: feedOf('a', 1) },
      );
      stored(t, ['https://p.io/a/0']);
      t.deps.posts.setThumbnail = async () => {
        throw new Error('AccessDenied');
      };
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const [r] = await crawlAllOk(t.deps, {});
      expect(r.status).toBe('ok');
      expect(err).toHaveBeenCalledWith(expect.stringContaining('AccessDenied'));
      err.mockRestore();
    });
  });

  it('skips disabled; sourceId crawls only that one', async () => {
    const sources = [mkSource('a'), mkSource('b', false), mkSource('c')];
    const all = setup(sources, rssOk);
    expect((await crawlAllOk(all.deps, {})).map((r) => r.sourceId)).toEqual(['a', 'c']);
    const one = setup(sources, rssOk);
    expect((await crawlAllOk(one.deps, { sourceId: 'b' })).map((r) => r.sourceId)).toEqual(['b']);
    expect(await crawlAllOk(one.deps, { sourceId: 'zzz' })).toEqual([]);
  });

  it('results carry the newest inserted post by publishedAt', async () => {
    const t = setup([mkSource('a')], rssOk);
    const [r] = await crawlAllOk(t.deps, { sourceId: 'a' });
    const max = [...t.saved].sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))[0];
    expect(t.saved.length).toBeGreaterThan(1);
    expect(r.newest).toBe(max);
    expect(t.recorded[0].r).not.toHaveProperty('newest');
  });

  it('newest skips posts that already existed', async () => {
    const first = setup([mkSource('a')], rssOk);
    await crawlAllOk(first.deps, {});
    const byDate = [...first.saved].sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
    const t = setup([mkSource('a')], rssOk, [byDate[0].postId]);
    const [r] = await crawlAllOk(t.deps, {});
    expect(r.newest?.postId).toBe(byDate[1].postId);
  });

  it('no newest when every post already exists', async () => {
    const first = setup([mkSource('a')], rssOk);
    await crawlAllOk(first.deps, {});
    const t = setup(
      [mkSource('a')],
      rssOk,
      first.saved.map((p) => p.postId),
    );
    const [r] = await crawlAllOk(t.deps, {});
    expect(r.newCount).toBe(0);
    expect(r).not.toHaveProperty('newest');
  });

  it('putIfAbsent false is not counted', async () => {
    const { deps } = setup([mkSource('a')], rssOk, [], (p) => !p.url.includes('blue-green'));
    const res = await crawlAllOk(deps, {});
    expect(res[0].newCount).toBe(2);
  });

  describe('settings', () => {
    // NOW is 2026-10-17T00:00Z = 07:00 in Asia/Ho_Chi_Minh.
    const many = (n: number) => {
      const items = Array.from(
        { length: n },
        (_, i) =>
          `<item><title>t${i}</title><link>https://p.io/${i}</link><pubDate>Fri, 16 Oct 2026 10:00:${String(i).padStart(2, '0')} GMT</pubDate><enclosure url="https://img.io/${i}.png" type="image/png"/></item>`,
      ).join('');
      const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
      return async () => ({ status: 200, body });
    };

    it('scheduled run is skipped outside the configured hours', async () => {
      const s = setup([mkSource('a')], many(3), [], undefined, {
        postsPerSource: 5,
        crawlHours: [8, 13],
        retentionDays: 90,
      });
      expect(await crawlAll(s.deps, { scheduled: true })).toBeNull();
      expect(s.fetched).toEqual([]);
    });

    it('scheduled run proceeds during a configured hour', async () => {
      const s = setup([mkSource('a')], many(3), [], undefined, {
        postsPerSource: 5,
        crawlHours: [7, 13],
        retentionDays: 90,
      });
      expect((await crawlAllOk(s.deps, { scheduled: true }))[0].newCount).toBe(3);
    });

    it('manual run ignores crawl hours, even when auto-crawl is off', async () => {
      const s = setup([mkSource('a')], many(3), [], undefined, {
        postsPerSource: 5,
        crawlHours: [],
        retentionDays: 90,
      });
      expect((await crawlAllOk(s.deps, {}))[0].newCount).toBe(3);
    });

    it('applies the global limit, overridden per source', async () => {
      const s = setup(
        [mkSource('a'), { ...mkSource('b'), postsPerSource: 2 }],
        many(10),
        [],
        undefined,
        { postsPerSource: 4, crawlHours: [7], retentionDays: 90 },
      );
      expect((await crawlAllOk(s.deps, {})).map((r) => r.newCount)).toEqual([4, 2]);
    });

    it('falls back to defaults when settings cannot be read', async () => {
      const s = setup([mkSource('a')], many(10));
      s.deps.settings = {
        get: async () => {
          throw new Error('ddb down');
        },
      };
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect((await crawlAllOk(s.deps, {}))[0].newCount).toBe(DEFAULT_SETTINGS.postsPerSource);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  });

  describe('retention', () => {
    const recent = (days: number) => {
      // NOW is 2026-10-17T00:00Z; one post 1 day old, one `days` old.
      const at = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toUTCString();
      const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title><item><title>new</title><link>https://p.io/new</link><pubDate>${at(1)}</pubDate><enclosure url="https://img.io/n.png" type="image/png"/></item><item><title>old</title><link>https://p.io/old</link><pubDate>${at(days)}</pubDate><enclosure url="https://img.io/o.png" type="image/png"/></item></channel></rss>`;
      return async () => ({ status: 200, body });
    };
    const settings = (retentionDays: number, crawlHours = [7]) => ({
      postsPerSource: 5,
      crawlHours,
      retentionDays,
    });

    it('full runs purge posts published before the retention window', async () => {
      const s = setup([mkSource('a')], rssOk, [], undefined, settings(30));
      await crawlAllOk(s.deps, {});
      expect(s.purgedBefore).toEqual(['2026-09-17T00:00:00.000Z']);
    });

    it('scheduled ticks purge even when they skip crawling', async () => {
      const s = setup([mkSource('a')], rssOk, [], undefined, settings(30, []));
      expect(await crawlAll(s.deps, { scheduled: true })).toBeNull();
      expect(s.purgedBefore).toHaveLength(1);
    });

    it('per-source runs and keep-forever do not purge', async () => {
      const one = setup([mkSource('a')], rssOk, [], undefined, settings(30));
      await crawlAllOk(one.deps, { sourceId: 'a' });
      expect(one.purgedBefore).toEqual([]);
      const forever = setup([mkSource('a')], rssOk, [], undefined, settings(0));
      await crawlAllOk(forever.deps, {});
      expect(forever.purgedBefore).toEqual([]);
    });

    it('does not import posts older than a short retention window', async () => {
      const s = setup([mkSource('a')], recent(5), [], undefined, settings(3));
      await crawlAllOk(s.deps, {});
      expect(s.saved.map((p) => p.title)).toEqual(['new']);
      const forever = setup([mkSource('a')], recent(5), [], undefined, settings(0));
      await crawlAllOk(forever.deps, {});
      expect(forever.saved.map((p) => p.title)).toEqual(['new', 'old']);
    });

    it('a failed purge is logged and crawling continues', async () => {
      const s = setup([mkSource('a')], rssOk, [], undefined, settings(30));
      s.deps.posts.deleteOlderThan = async () => {
        throw new Error('ddb down');
      };
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect((await crawlAllOk(s.deps, {}))[0].status).toBe('ok');
      expect(err).toHaveBeenCalledWith(expect.stringContaining('purge failed'));
      err.mockRestore();
    });
  });
});
