import type { SourceResult } from '../../src/crawler/crawl';
import { notifyAfterCrawl, notifyNewPosts, type NotifyDeps } from '../../src/crawler/notify';
import { buildPayload, type PushSubscriptionRecord } from '../../src/lib/push';
import type { Post } from '../../src/lib/types';

const mkPost = (over: Partial<Post>): Post => ({
  postId: 'p',
  url: 'https://b.example/p',
  title: 'T',
  publishedAt: '2026-10-01T00:00:00.000Z',
  sourceId: 'S1',
  sourceName: 'Blog',
  feedKey: 'ALL',
  crawledAt: '2026-10-02T00:00:00.000Z',
  ...over,
});
const sub = (id: string): PushSubscriptionRecord => ({
  id,
  endpoint: `https://fcm.googleapis.com/${id}`,
  p256dh: 'p',
  auth: 'a',
  createdAt: 't',
  updatedAt: 't',
});
const ok = (id: string, newCount: number, newest?: Post): SourceResult => ({
  sourceId: id,
  status: 'ok',
  newCount,
  ...(newest ? { newest } : {}),
});
const statusError = (statusCode: number) => Object.assign(new Error('push'), { statusCode });

function mk(subs: PushSubscriptionRecord[], send: NotifyDeps['sendPush'] = async () => {}) {
  const deps = {
    subscriptions: {
      list: jest.fn(async () => subs),
      remove: jest.fn<Promise<void>, [string]>(async () => {}),
    },
    sendPush: jest.fn(send),
  };
  return deps;
}

let log: jest.SpyInstance;
let err: jest.SpyInstance;
beforeEach(() => {
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
  err = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const lines = (spy: jest.SpyInstance) =>
  spy.mock.calls.map((c) => {
    try {
      return JSON.parse(String(c[0]));
    } catch {
      return {};
    }
  });

describe('notifyNewPosts', () => {
  it('sends the newest post across sources to every subscription', async () => {
    const older = mkPost({ title: 'Older', publishedAt: '2026-10-01T00:00:00.000Z' });
    const newer = mkPost({
      title: 'Newer',
      sourceName: 'Other',
      publishedAt: '2026-10-05T00:00:00.000Z',
    });
    const d = mk([sub('a'), sub('b')]);
    const out = await notifyNewPosts(d, [ok('S1', 3, older), ok('S2', 2, newer), ok('S3', 0)]);
    expect(out).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(d.sendPush).toHaveBeenCalledTimes(2);
    expect(d.sendPush).toHaveBeenCalledWith(sub('a'), buildPayload(newer, 5));
    expect(d.sendPush).toHaveBeenCalledWith(sub('b'), buildPayload(newer, 5));
  });

  it('ties on publishedAt keep the earlier result', async () => {
    const at = '2026-10-05T00:00:00.000Z';
    const first = mkPost({ title: 'Same', sourceName: 'First', publishedAt: at });
    const second = mkPost({ title: 'Same', sourceName: 'Second', publishedAt: at });
    const d = mk([sub('a')]);
    await notifyNewPosts(d, [ok('S1', 1, first), ok('S2', 1, second)]);
    expect(d.sendPush).toHaveBeenCalledWith(sub('a'), buildPayload(first, 2));
  });

  it('removes 404/410 subscriptions and keeps other failures', async () => {
    const codes: Record<string, number | undefined> = { a: undefined, b: 410, c: 404, d: 500 };
    const d = mk([sub('a'), sub('b'), sub('c'), sub('d')], async (s) => {
      const code = codes[s.id];
      if (code) throw statusError(code);
    });
    const out = await notifyNewPosts(d, [ok('S1', 1, mkPost({}))]);
    expect(out).toEqual({ sent: 1, removed: 2, failed: 1 });
    expect(d.subscriptions.remove.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']);
  });

  it('a failed remove counts as failed, not thrown', async () => {
    const d = mk([sub('a')], async () => {
      throw statusError(410);
    });
    d.subscriptions.remove.mockRejectedValue(new Error('ddb down'));
    expect(await notifyNewPosts(d, [ok('S1', 1, mkPost({}))])).toEqual({
      sent: 0,
      removed: 0,
      failed: 1,
    });
  });

  it('does nothing without subscriptions', async () => {
    const d = mk([]);
    expect(await notifyNewPosts(d, [ok('S1', 1, mkPost({}))])).toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    expect(d.sendPush).not.toHaveBeenCalled();
  });
});

describe('notifyAfterCrawl', () => {
  const results = [ok('S1', 2, mkPost({}))];

  it('notifies after a full run with new posts and logs push.summary', async () => {
    const d = mk([sub('a')]);
    await notifyAfterCrawl(d, {}, results);
    expect(d.sendPush).toHaveBeenCalledTimes(1);
    expect(lines(log)).toContainEqual({ msg: 'push.summary', sent: 1, removed: 0, failed: 0 });
  });

  it.each([
    ['a single-source run', { sourceId: 'S1' }, results],
    ['a skipped run', {}, null],
    ['zero new posts', {}, [ok('S1', 0)]],
  ])('does not list subscriptions for %s', async (_, event, res) => {
    const d = mk([sub('a')]);
    await notifyAfterCrawl(d, event, res);
    expect(d.subscriptions.list).not.toHaveBeenCalled();
  });

  it('logs push.skipped without VAPID config', async () => {
    await notifyAfterCrawl(null, {}, results);
    expect(lines(log).map((l) => l.msg)).toContain('push.skipped');
  });

  it('never throws; logs push.failed', async () => {
    const d = mk([]);
    d.subscriptions.list.mockRejectedValue(new Error('ddb down'));
    await expect(notifyAfterCrawl(d, {}, results)).resolves.toBeUndefined();
    expect(lines(err).map((l) => l.msg)).toContain('push.failed');
  });
});
