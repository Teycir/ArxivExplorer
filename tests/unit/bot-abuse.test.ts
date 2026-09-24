/**
 * tests/unit/bot-abuse.test.ts
 *
 * ADVERSARIAL harness: drives the real middleware the way a crawler would and
 * asserts the properties that must hold for the D1 quota to survive.
 *
 * Unlike api-hardening.test.ts (which only checks that limiters EXIST), these
 * tests exercise limiter BEHAVIOUR. Each test is named after the bot strategy
 * it models. A failing test here is a demonstrated logic flaw, not a style nit.
 *
 * No Cloudflare bindings, no network, no wrangler: in-memory KV + Cache mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRateLimit,
  getClientIP,
  withRateLimit,
  INTERNAL_BUCKET,
  type RateLimitConfig,
  type NativeRateLimiter,
} from '../../src/api-worker/middleware/rate-limit.js';
import { withEdgeCache, canonicalCacheUrl } from '../../src/api-worker/cache/edge.js';

// ─── mocks ───────────────────────────────────────────────────────────────────

interface KvStats { gets: number; puts: number; }

function makeKV(opts: { failPuts?: boolean; failGets?: boolean } = {}): { kv: KVNamespace; stats: KvStats } {
  const store = new Map<string, string>();
  const stats: KvStats = { gets: 0, puts: 0 };
  const kv = {
    async get(key: string, type?: string) {
      stats.gets++;
      if (opts.failGets) throw new Error('KV get quota exhausted');
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      stats.puts++;
      if (opts.failPuts) throw new Error('KV put limit exceeded');
      store.set(key, value);
    },
    async delete(key: string) { store.delete(key); },
  } as unknown as KVNamespace;
  return { kv, stats };
}

/** Cache API mock keyed by URL — mirrors caches.default semantics. */
function installCacheMock(): { store: Map<string, Response>; restore: () => void } {
  const store = new Map<string, Response>();
  const g = globalThis as { caches?: unknown };
  const prev = g.caches;
  g.caches = {
    default: {
      async match(req: Request) { const r = store.get(req.url); return r ? r.clone() : undefined; },
      async put(req: Request, res: Response) { store.set(req.url, res.clone()); },
    },
  };
  return { store, restore: () => { g.caches = prev; } };
}

function fakeCtx(): ExecutionContext {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(p: Promise<unknown>) { pending.push(p); },
    passThroughOnException() {},
    // exposed for tests that want to flush
    _flush: () => Promise.allSettled(pending),
  } as unknown as ExecutionContext;
}

const CORS: Record<string, string> = {};
const CFG: RateLimitConfig = { maxRequests: 20, windowSeconds: 60, lockoutSeconds: 300, namespace: 'topics' };

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

// ─── 1. Edge-cache key cardinality ───────────────────────────────────────────
//
// /api/topics and /api/stats ignore their query string. If the cache key is the
// raw URL, a bot appending ?x=<n> gets a fresh cache miss every time and every
// miss falls through to KV/D1.

describe('edge cache — query-string cache busting', () => {
  it('BOT: /api/topics?cb=<n> must not produce a distinct cache entry per n', async () => {
    const { store, restore } = installCacheMock();
    try {
      let handlerCalls = 0;
      const handler = async () => { handlerCalls++; return new Response('{"topics":[]}', { status: 200 }); };

      for (let i = 0; i < 50; i++) {
        const ctx = fakeCtx();
        await withEdgeCache(req(`https://api.test/api/topics?cb=${i}`), ctx, 3600, handler);
        await (ctx as unknown as { _flush: () => Promise<unknown> })._flush();
      }

      assert.equal(
        handlerCalls, 1,
        `handler ran ${handlerCalls}x for 50 requests that differ only by a junk query param ` +
        `(${store.size} distinct cache entries). The edge cache key includes the raw query string, so ` +
        `a bot bypasses the cache — and therefore reaches KV/D1 — on every request.`
      );
    } finally { restore(); }
  });
});

// ─── 2. Limiter identity ─────────────────────────────────────────────────────

describe('limiter identity — spoofing', () => {
  it('BOT: forged x-real-ip without the internal secret must not mint a bucket', () => {
    const ips = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ips.add(getClientIP(req('https://api.test/api/search', { 'x-real-ip': `10.0.0.${i}` }), 'secret'));
    }
    assert.equal(ips.size, 1, 'each forged x-real-ip produced its own bucket');
    assert.ok(ips.has(INTERNAL_BUCKET));
  });

  it('KNOWN GAP: a header-less caller is filed under INTERNAL and is NOT bounded per-IP', async () => {
    // By design: no cf-connecting-ip == our own service-binding worker. On a real
    // *.workers.dev request Cloudflare always injects cf-connecting-ip, so an
    // outside attacker cannot reach this path; only SSR traffic does. This test
    // PINS that trade-off so widening or removing it is a conscious change.
    const { kv } = makeKV();
    let allowed = 0;
    for (let i = 0; i < 200; i++) {
      const res = await withRateLimit(req('https://api.test/api/topics'), kv, CFG, CORS,
        async () => new Response('ok'), undefined, 'secret');
      if (res.status === 200) allowed++;
    }
    assert.equal(allowed, 200, 'INTERNAL bucket ceiling is 5,000/window — 200 must all pass');
  });
});

// ─── 3. Native limiter is per-colo & permissive ──────────────────────────────

describe('limiter availability', () => {
  it('BOT: when native limiter throws, fallback must still bound a single IP', async () => {
    const { kv } = makeKV();
    const broken: NativeRateLimiter = { async limit() { throw new Error('binding down'); } };
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      const res = await withRateLimit(req('https://api.test/api/topics', { 'cf-connecting-ip': '9.9.9.9' }),
        kv, CFG, CORS, async () => new Response('ok'), broken, 'secret');
      if (res.status === 200) allowed++;
    }
    assert.ok(allowed <= CFG.maxRequests, `allowed ${allowed}/100 with native limiter down`);
  });

  it('BOT: KV fully exhausted (get+put fail) — one IP must still be bounded', async () => {
    const { kv } = makeKV({ failGets: true, failPuts: true });
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      const res = await withRateLimit(req('https://api.test/api/topics', { 'cf-connecting-ip': '8.8.8.8' }),
        kv, CFG, CORS, async () => new Response('ok'), undefined, 'secret');
      if (res.status === 200) allowed++;
    }
    assert.ok(allowed <= CFG.maxRequests, `allowed ${allowed}/100 with KV down`);
  });

  it('BOT: distributed crawl (500 distinct IPs) — aggregate D1-bound requests', async () => {
    // Per-IP limiting cannot bound a distributed crawler. This test documents the
    // ceiling: total handler invocations = ips × maxRequests, none of it coordinated.
    const { kv } = makeKV();
    let reachedHandler = 0;
    for (let ip = 0; ip < 500; ip++) {
      for (let r = 0; r < 30; r++) {
        const res = await withRateLimit(
          req('https://api.test/api/search?q=x', { 'cf-connecting-ip': `203.0.113.${ip % 250}.${ip}` }),
          kv, { ...CFG, namespace: 'search', maxRequests: 60 }, CORS,
          async () => { reachedHandler++; return new Response('ok'); }, undefined, 'secret');
        void res;
      }
    }
    // Informational: report the aggregate, assert only that it is finite.
    console.log(`    [info] 500 IPs × 30 req → ${reachedHandler} handler invocations reached D1`);
    assert.ok(reachedHandler > 0);
  });
});

// ─── 4. Lockout behaviour ────────────────────────────────────────────────────

describe('lockout semantics', () => {
  it('a locked-out IP must stay blocked for the whole lockout, not just the window', async () => {
    const { kv } = makeKV();
    const ip = '1.1.1.1';
    for (let i = 0; i < CFG.maxRequests + 1; i++) await checkRateLimit(kv, ip, CFG);
    const during = await checkRateLimit(kv, ip, CFG);
    assert.equal(during.allowed, false);
    assert.ok((during.resetIn ?? 0) > CFG.windowSeconds, 'lockout should outlast the window');
  });
});

// ─── 5. The SSR path: what a bot page-view actually costs ────────────────────
//
// helper/api.ts reaches the API worker via the `API` service binding for every
// server-rendered page. Service-binding requests carry NO cf-connecting-ip, so
// the limiter files them all under INTERNAL_BUCKET. This models one bot walking
// /search?q=<unique> and asks how many of those reach the D1-bound handler.

describe('SSR / service-binding path — the bot page-view chain', () => {
  const SEARCH_CFG: RateLimitConfig = { maxRequests: 60, windowSeconds: 60, lockoutSeconds: 120, namespace: 'search' };

  it('KNOWN GAP: SSR calls WITHOUT forwarded identity are unbounded per visitor', async () => {
    // This is the pre-fix behaviour, kept as a regression witness. It is what the
    // API sees when INTERNAL_TOKEN is missing on either worker, because helper/api.ts
    // then forwards nothing. The fix is the forwarded-identity path (section 7).
    // If this ever starts failing, the INTERNAL_BUCKET semantics changed — re-read
    // rate-limit.ts before "fixing" the test.
    const { kv } = makeKV();
    let reachedD1 = 0;
    for (let i = 0; i < 2000; i++) {
      await withRateLimit(
        req(`https://api-internal/api/search?q=unique-bot-query-${i}`),
        kv, SEARCH_CFG, CORS,
        async () => { reachedD1++; return new Response('ok'); },
        undefined, 'secret'
      );
    }
    assert.equal(reachedD1, 2000, 'unforwarded SSR traffic must be the unbounded baseline');
  });

  it('BOT: two different crawlers are indistinguishable on the SSR path', async () => {
    const { kv } = makeKV();
    // Both arrive via the binding — identity is lost, so they share one bucket.
    const a = getClientIP(req('https://api-internal/api/search?q=a'), 'secret');
    const b = getClientIP(req('https://api-internal/api/search?q=b'), 'secret');
    assert.equal(a, b);
    assert.equal(a, INTERNAL_BUCKET);
    void kv;
  });
});

// ─── 6. Cache key canonicalisation (post-fix guards) ─────────────────────────

describe('canonicalCacheUrl', () => {
  it('drops every param when none are allow-listed', () => {
    assert.equal(
      canonicalCacheUrl('https://api.test/api/topics?cb=1&utm=x'),
      'https://api.test/api/topics'
    );
  });

  it('keeps only allow-listed params and normalises order', () => {
    assert.equal(
      canonicalCacheUrl('https://api.test/api/trending?junk=1&window=day', ['window']),
      'https://api.test/api/trending?window=day'
    );
  });

  it('BOT: /api/trending?window=<garbage> must not mint a key per garbage value', async () => {
    // The handler validates `window` against a whitelist, but the cache key sees
    // the RAW value — so unvalidated values re-open the cache-busting hole.
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(canonicalCacheUrl(`https://api.test/api/trending?window=junk${i}`, {
        window: (raw) => (['day', 'week', 'month'].includes(raw ?? '') ? raw : 'week'),
      }));
    }
    assert.equal(keys.size, 1, `${keys.size} distinct keys for 50 invalid window values`);
  });
});

// ─── 7. Authenticated identity forwarding (post-fix contract) ────────────────
//
// helper/api.ts now forwards X-Real-IP + X-Internal-Auth on SSR calls. These
// tests pin the API-side contract that makes that useful.

describe('SSR identity forwarding — API-side contract', () => {
  const SEARCH_CFG: RateLimitConfig = { maxRequests: 60, windowSeconds: 60, lockoutSeconds: 120, namespace: 'search' };
  const ssr = (ip: string, q: number, auth = 'secret') =>
    req(`https://api-internal/api/search?q=unique-${q}`, { 'x-real-ip': ip, 'x-internal-auth': auth });

  it('a crawler forwarded WITH the secret is bounded to its own per-IP limit', async () => {
    const { kv } = makeKV();
    let reachedD1 = 0;
    for (let i = 0; i < 2000; i++) {
      await withRateLimit(ssr('198.51.100.7', i), kv, SEARCH_CFG, CORS,
        async () => { reachedD1++; return new Response('ok'); }, undefined, 'secret');
    }
    console.log(`    [info] forwarded-identity crawler: 2,000 page views -> ${reachedD1} reached D1`);
    assert.ok(reachedD1 <= SEARCH_CFG.maxRequests, `${reachedD1}/2000 reached D1`);
  });

  it('one crawler being throttled does NOT lock out a different visitor', async () => {
    const { kv } = makeKV();
    for (let i = 0; i < 200; i++) {
      await withRateLimit(ssr('198.51.100.7', i), kv, SEARCH_CFG, CORS,
        async () => new Response('ok'), undefined, 'secret');
    }
    const res = await withRateLimit(ssr('203.0.113.9', 1), kv, SEARCH_CFG, CORS,
      async () => new Response('ok'), undefined, 'secret');
    assert.equal(res.status, 200, 'a legitimate visitor was collateral damage of the bot');
  });

  it('a WRONG secret must not mint identity (still collapses to internal)', () => {
    assert.equal(getClientIP(ssr('198.51.100.7', 1, 'wrong'), 'secret'), INTERNAL_BUCKET);
  });

  it('with INTERNAL_TOKEN unset on the API, forwarded IPs are ignored (fail-safe)', () => {
    assert.equal(getClientIP(ssr('198.51.100.7', 1), undefined), INTERNAL_BUCKET);
  });
});
