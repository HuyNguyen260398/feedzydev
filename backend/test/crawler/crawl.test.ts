import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crawlAll, OG_FETCH_BUDGET, type CrawlDeps } from '../../src/crawler/crawl';
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
  fetchImpl: (url: string) => Promise<{ status: number; body: string }>,
  existing: string[] = [],
  putResult: (p: Post) => boolean = () => true,
  settings: Settings = { postsPerSource: 50, crawlHours: [7] },
) {
  const saved: Post[] = [];
  const recorded: { id: string; r: Record<string, unknown> }[] = [];
  const fetched: string[] = [];
  const fetchText: FetchText = async (url) => {
    fetched.push(url);
    const r = await fetchImpl(url);
    return { status: r.status, url, contentType: 'text/xml', body: r.body };
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
      exists: async (id) => existing.includes(id),
      putIfAbsent: async (p) => {
        const ok = putResult(p);
        if (ok) saved.push(p);
        return ok;
      },
    },
    settings: { get: async () => settings },
    fetchText,
    now: () => NOW,
  };
  return { deps, saved, recorded, fetched };
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
  it('saves new posts and records ok', async () => {
    const { deps, saved, recorded } = setup([mkSource('a')], async (url) =>
      url.endsWith('/feed') ? { status: 200, body: feedXml } : { status: 404, body: '' },
    );
    const res = await crawlAllOk(deps, {});
    expect(res).toEqual([{ sourceId: 'a', status: 'ok', newCount: 3 }]);
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

  it('og:image fallback only for new thumbnail-less posts', async () => {
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
      { postsPerSource: 5, crawlHours: [7] },
    );
    const res = await crawlAllOk(deps, {});
    expect(res.map((r) => r.newCount)).toEqual(Array(7).fill(5));
    expect(fetched.filter((u) => u.startsWith('https://p.io/'))).toHaveLength(30);
  });

  it('skips disabled; sourceId crawls only that one', async () => {
    const sources = [mkSource('a'), mkSource('b', false), mkSource('c')];
    const all = setup(sources, rssOk);
    expect((await crawlAllOk(all.deps, {})).map((r) => r.sourceId)).toEqual(['a', 'c']);
    const one = setup(sources, rssOk);
    expect((await crawlAllOk(one.deps, { sourceId: 'b' })).map((r) => r.sourceId)).toEqual(['b']);
    expect(await crawlAllOk(one.deps, { sourceId: 'zzz' })).toEqual([]);
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
      });
      expect(await crawlAll(s.deps, { scheduled: true })).toBeNull();
      expect(s.fetched).toEqual([]);
    });

    it('scheduled run proceeds during a configured hour', async () => {
      const s = setup([mkSource('a')], many(3), [], undefined, {
        postsPerSource: 5,
        crawlHours: [7, 13],
      });
      expect((await crawlAllOk(s.deps, { scheduled: true }))[0].newCount).toBe(3);
    });

    it('manual run ignores crawl hours, even when auto-crawl is off', async () => {
      const s = setup([mkSource('a')], many(3), [], undefined, {
        postsPerSource: 5,
        crawlHours: [],
      });
      expect((await crawlAllOk(s.deps, {}))[0].newCount).toBe(3);
    });

    it('applies the global limit, overridden per source', async () => {
      const s = setup(
        [mkSource('a'), { ...mkSource('b'), postsPerSource: 2 }],
        many(10),
        [],
        undefined,
        { postsPerSource: 4, crawlHours: [7] },
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
});
