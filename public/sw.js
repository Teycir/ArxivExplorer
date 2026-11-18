/* Offline / quota-degraded support.
 * Cloudflare Error 1027 is enforced at the edge before the Worker runs, so the
 * only thing that still answers is a static asset. This worker therefore keeps
 * a copy of visited pages + successful GET data, and serves /offline.html as the
 * last resort. Compute operations degrade to a JSON message instead of an HTML
 * error page. */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const OFFLINE = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.add(OFFLINE).catch(() => {});
      await Promise.all(
        ['/rss.xml', '/sitemap.xml'].map((url) =>
          fetch(url)
            .then((res) => (res.ok ? shell.put(url, res) : undefined))
            .catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const STATIC_EXT = /\.(css|js|mjs|map|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|txt|xml)$/i;

function isStatic(url) {
  return url.pathname.startsWith('/_next/static/') || STATIC_EXT.test(url.pathname);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function staleCopy(cached) {
  const headers = new Headers(cached.headers);
  headers.set('X-SW-Cache', 'stale');
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}

async function notifyQuota() {
  const windows = await self.clients.matchAll({ type: 'window' });
  windows.forEach((c) => c.postMessage({ type: 'quota-exceeded' }));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function navigation(request) {
  const shell = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(request), 4000);
    if (res.ok) {
      shell.put(request, res.clone()).catch(() => {});
      return res;
    }
    if (res.status === 429) notifyQuota();
  } catch {}
  return (
    (await shell.match(request)) ||
    (await shell.match('/')) ||
    (await caches.match(OFFLINE)) ||
    json(503, { error: 'offline', message: 'No cached copy of this page yet.' })
  );
}

async function apiGet(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const data = await caches.open(DATA);
      data.put(request, res.clone()).catch(() => {});
      return res;
    }
    if (res.status === 429) {
      notifyQuota();
      const cached = await caches.match(request);
      if (cached) return staleCopy(cached);
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return staleCopy(cached);
    notifyQuota();
    return json(503, {
      error: 'compute_unavailable',
      message: 'Live search and summaries are paused: this site reached its Cloudflare free-tier daily request limit. Cached pages, the RSS snapshot and your bookmarks still work.',
    });
  }
}

async function computePost(request) {
  try {
    const res = await fetch(request);
    if (res.status !== 429) return res;
    notifyQuota();
  } catch {
    notifyQuota();
  }
  return json(503, {
    error: 'compute_unavailable',
    message: 'This needs live compute, which is paused: the site reached its Cloudflare free-tier daily request limit (resets 00:00 UTC). Cached pages, the RSS snapshot and your bookmarks still work.',
  });
}

async function staticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const shell = await caches.open(SHELL);
    shell.put(request, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== 'GET') {
    event.respondWith(computePost(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiGet(request));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(staticAsset(request));
  }
});
