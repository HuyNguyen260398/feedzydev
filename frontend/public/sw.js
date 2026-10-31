// feedzydev service worker: installable app shell plus offline reading of the last-seen feed.
// Bump VERSION to drop every cache on the next visit.
const VERSION = 'v1';
const SHELL = `fz-shell-${VERSION}`; // pages and public assets: network-first / stale-while-revalidate
const STATIC = `fz-static-${VERSION}`; // content-hashed /_next/static: cache-first
const API = `fz-api-${VERSION}`; // public API reads: network-first, cached for offline
const CACHES = [SHELL, STATIC, API];

const PRECACHE = ['/', '/sources/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
const MAX_ENTRIES = { [STATIC]: 150, [API]: 60, [SHELL]: 60 };
const NETWORK_TIMEOUT_MS = 6000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // One by one so a single failure (e.g. offline) does not abort the install.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !CACHES.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cross-origin (thumbnails, Cognito) is left to the browser.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Admin data is private and must always be live.
    if (url.pathname.startsWith('/api/admin') || req.headers.has('Authorization')) return;
    event.respondWith(networkFirst(req, API));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, SHELL));
});

async function put(cacheName, req, res) {
  // Redirected responses cannot be replayed for navigations (Safari rejects them).
  if (!res || !res.ok || res.type === 'opaque' || res.redirected) return;
  const cache = await caches.open(cacheName);
  await cache.put(req, res);
  const keys = await cache.keys();
  const max = MAX_ENTRIES[cacheName];
  // Keys come back in insertion order, so the oldest go first.
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function fetchWithTimeout(req) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(req).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetchWithTimeout(req);
    if (res.ok) await put(cacheName, req, res.clone());
    return res;
  } catch (err) {
    const cached = await caches.match(req, { cacheName });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req, { cacheName });
  if (cached) return cached;
  const res = await fetch(req);
  await put(cacheName, req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cached = await caches.match(req, { cacheName });
  const network = fetch(req)
    .then(async (res) => {
      await put(cacheName, req, res.clone());
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

async function navigate(req) {
  try {
    const res = await fetchWithTimeout(req);
    // Store pages without their query (e.g. the Cognito ?code= callback).
    if (res.ok) await put(SHELL, new URL(req.url).pathname, res.clone());
    return res;
  } catch {
    const cache = await caches.open(SHELL);
    return (
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match('/')) ||
      Response.error()
    );
  }
}

// --- Push notifications (new posts after a crawl) ---

const FALLBACK_NOTIFICATION = { title: 'New posts on feedzydev', body: 'Click to read' };

/**
 * Turns a push payload into showNotification() arguments. Missing or malformed data still
 * yields a generic notification: browsers penalise pushes that show nothing.
 */
function notificationFromPush(data) {
  let p = {};
  try {
    const parsed = data ? data.json() : null;
    if (parsed && typeof parsed === 'object') p = parsed;
  } catch {
    // not JSON; use the fallback
  }
  const title = typeof p.title === 'string' && p.title ? p.title : FALLBACK_NOTIFICATION.title;
  const body = typeof p.body === 'string' && p.body ? p.body : FALLBACK_NOTIFICATION.body;
  const url = typeof p.url === 'string' && /^\/(?!\/)/.test(p.url) ? p.url : '/';
  return {
    title,
    options: {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      ...(typeof p.image === 'string' && p.image ? { image: p.image } : {}),
      tag: typeof p.tag === 'string' && p.tag ? p.tag : 'feedzy-new-posts',
      renotify: true,
      data: { url },
    },
  };
}

self.addEventListener('push', (event) => {
  const { title, options } = notificationFromPush(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        await client.navigate(url).catch(() => {});
        await client.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
