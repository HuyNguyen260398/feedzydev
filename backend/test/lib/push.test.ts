import { buildPayload, parseSubscription, subscriptionId } from '../../src/lib/push';

describe('subscriptionId', () => {
  it('is the hex sha256 of the endpoint', () => {
    expect(subscriptionId('https://fcm.googleapis.com/x')).toMatch(/^[0-9a-f]{64}$/);
    expect(subscriptionId('a')).toBe(subscriptionId('a'));
    expect(subscriptionId('a')).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    );
  });
});

describe('parseSubscription', () => {
  const ok = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'BNc-_1', auth: 'tB_-2' },
  };

  it('accepts allowlisted hosts', () => {
    for (const e of [
      'https://fcm.googleapis.com/a',
      'https://updates.push.services.mozilla.com/a',
      'https://push.services.mozilla.com/a',
      'https://web.push.apple.com/a',
      'https://wns2-sg2p.notify.windows.com/w/?token=x',
    ])
      expect(parseSubscription({ ...ok, endpoint: e }).endpoint).toBe(e);
  });

  it('returns the flattened keys', () => {
    expect(parseSubscription(ok)).toEqual({
      endpoint: ok.endpoint,
      p256dh: 'BNc-_1',
      auth: 'tB_-2',
    });
  });

  it.each([
    'http://fcm.googleapis.com/a',
    'https://fcm.googleapis.com.evil.io/a',
    'https://evilpush.apple.com/a',
    'https://push.apple.com.evil.io/a',
    'https://example.com/a',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(1024)}`,
  ])('rejects endpoint %s', (endpoint) => {
    expect(() => parseSubscription({ ...ok, endpoint })).toThrow(
      expect.objectContaining({ status: 400, code: 'INVALID_SUBSCRIPTION' }),
    );
  });

  it.each([
    {},
    { p256dh: 'a' },
    { p256dh: 'a+b', auth: 'c' },
    { p256dh: 'a'.repeat(257), auth: 'c' },
    { p256dh: '', auth: 'c' },
  ])('rejects keys %j', (keys) => {
    expect(() => parseSubscription({ ...ok, keys })).toThrow(
      expect.objectContaining({ code: 'INVALID_SUBSCRIPTION' }),
    );
  });

  it('rejects a missing keys object', () => {
    expect(() => parseSubscription({ endpoint: ok.endpoint })).toThrow(
      expect.objectContaining({ code: 'INVALID_SUBSCRIPTION' }),
    );
  });
});

describe('buildPayload', () => {
  const p = {
    title: 'AWS launches X',
    sourceName: 'AWS News Blog',
    thumbnailUrl: 'https://i/x.png',
  };

  it('counts the others', () => {
    expect(buildPayload(p, 12)).toEqual({
      title: 'AWS launches X',
      body: 'AWS News Blog · Click to read 11 more posts',
      url: '/',
      image: 'https://i/x.png',
      tag: 'feedzy-new-posts',
    });
  });

  it('single post copy and no image key', () => {
    const out = buildPayload({ title: 'T', sourceName: 'S' }, 1);
    expect(out.body).toBe('S · Click to read');
    expect('image' in out).toBe(false);
  });

  it('truncates long titles to 120 chars', () => {
    expect(buildPayload({ ...p, title: 'x'.repeat(300) }, 2).title).toHaveLength(120);
  });
});
