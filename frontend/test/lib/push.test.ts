import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the same mocks survive vi.resetModules() between VAPID key settings.
const api = vi.hoisted(() => ({
  postSubscription: vi.fn<(sub: PushSubscriptionJSON) => Promise<{ id: string }>>(),
  deleteSubscription: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('@/lib/api', () => api);

const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15';
const realUA = navigator.userAgent;

interface FakeSub {
  endpoint: string;
  toJSON: () => PushSubscriptionJSON;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSub(): FakeSub {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

let current: FakeSub | null;
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let notification: {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn>;
};

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

/** Installs a browser with Push support; `supported: false` removes PushManager (iOS Safari tab). */
function browser({ supported = true } = {}) {
  current = null;
  pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = fakeSub();
      return current;
    }),
  };
  notification = { permission: 'default', requestPermission: vi.fn(async () => 'granted') };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  if (supported) {
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', notification);
  } else {
    vi.stubGlobal('PushManager', undefined);
    vi.stubGlobal('Notification', undefined);
    delete (window as { PushManager?: unknown }).PushManager;
    delete (window as { Notification?: unknown }).Notification;
  }
}

async function load(key = KEY) {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', key);
  vi.resetModules();
  return import('@/lib/push');
}

beforeEach(() => {
  api.postSubscription.mockReset().mockResolvedValue({ id: 'x' });
  api.deleteSubscription.mockReset().mockResolvedValue(undefined);
  browser();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setUA(realUA);
});

describe('getPushState', () => {
  it('is hidden without a VAPID key', async () => {
    const push = await load('');
    expect(await push.getPushState()).toBe('hidden');
  });

  it('is hidden in mock mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1');
    const push = await load();
    expect(await push.getPushState()).toBe('hidden');
  });

  it('asks iPhone Safari tabs to install first', async () => {
    browser({ supported: false });
    setUA(IPHONE);
    const push = await load();
    expect(await push.getPushState()).toBe('needs-install');
  });

  it('is hidden when an unsupported browser is not iOS', async () => {
    browser({ supported: false });
    const push = await load();
    expect(await push.getPushState()).toBe('hidden');
  });

  it('is blocked when permission was denied', async () => {
    notification.permission = 'denied';
    const push = await load();
    expect(await push.getPushState()).toBe('blocked');
  });

  it('is on with a subscription and off without one', async () => {
    const push = await load();
    expect(await push.getPushState()).toBe('off');
    current = fakeSub();
    expect(await push.getPushState()).toBe('on');
  });
});

describe('subscribe', () => {
  it('asks for permission, subscribes with the VAPID key and stores it', async () => {
    const push = await load();
    expect(await push.subscribe()).toBe('on');
    expect(notification.requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: push.urlBase64ToUint8Array(KEY),
    });
    expect(api.postSubscription).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('returns blocked when denied and off when dismissed, without subscribing', async () => {
    const push = await load();
    notification.requestPermission.mockResolvedValueOnce('denied');
    expect(await push.subscribe()).toBe('blocked');
    notification.requestPermission.mockResolvedValueOnce('default');
    expect(await push.subscribe()).toBe('off');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('undoes the browser subscription when the server rejects it', async () => {
    const push = await load();
    const err = new Error('full');
    api.postSubscription.mockRejectedValueOnce(err);
    await expect(push.subscribe()).rejects.toBe(err);
    expect(current?.unsubscribe).toHaveBeenCalled();
  });
});

describe('unsubscribe', () => {
  it('deletes by endpoint hash and unsubscribes the browser', async () => {
    const push = await load();
    const sub = fakeSub();
    current = sub;
    expect(await push.unsubscribe()).toBe('off');
    expect(api.deleteSubscription).toHaveBeenCalledWith(await push.endpointId(ENDPOINT));
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});

describe('resync', () => {
  it('re-posts an existing subscription when permission is granted', async () => {
    notification.permission = 'granted';
    current = fakeSub();
    const push = await load();
    await push.resync();
    expect(api.postSubscription).toHaveBeenCalledWith(current.toJSON());
  });

  it('does not subscribe when there is no subscription', async () => {
    notification.permission = 'granted';
    const push = await load();
    await push.resync();
    expect(api.postSubscription).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('swallows server errors', async () => {
    notification.permission = 'granted';
    current = fakeSub();
    api.postSubscription.mockRejectedValueOnce(new Error('down'));
    const push = await load();
    await expect(push.resync()).resolves.toBeUndefined();
  });
});

describe('helpers', () => {
  it('endpointId is the hex sha256, matching the server', async () => {
    const push = await load();
    expect(await push.endpointId('a')).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    );
  });

  it('urlBase64ToUint8Array decodes base64url', async () => {
    const push = await load();
    expect(Array.from(push.urlBase64ToUint8Array('-_8'))).toEqual([0xfb, 0xff]);
  });
});
