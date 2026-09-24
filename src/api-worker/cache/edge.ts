/**
 * src/api-worker/cache/edge.ts
 * Cloudflare Cache API helper (caches.default) — the cheap cache layer.
 *
 * WHERE IT IS APPLIED (maintenance note — see tests/unit/api-hardening.test.ts)
 * ────────────────────────────────────────────────────────────────────────────
 *   /api/topics   1h    /api/stats   1h    /api/sitemap   24h    /api/trending  10m–3h
 *
 * Only these four are wrapped, on purpose. Their response shape is stable and
 * anonymous, which is what makes them safe to cache:
 *   • /api/search  — must not cache `degraded: true` leg failures (KV already
 *     caches it at 2h, and only clean results get written);
 *   • /api/paper   — `summary_ready = 0` polls (every 10 s) must not be frozen;
 *   • /api/claim   — personalised AI result, POST.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The KV response cache costs one KV write per cache miss, against the Workers
 * free tier budget of **1,000 writes/day**. The rate limiter was writing a KV key
 * on *every* request, so the write budget was routinely exhausted — after which
 * `kvPutAsync` silently stopped persisting anything, the cache never populated,
 * and every request fell through to D1. That is the mechanism that turned a
 * crawler spike into the September 2026 quota outage.
 *
 * The Cache API is per-colo, free, and has **no daily write quota**, so it is used
 * as a second layer in front of the KV cache for the hot read endpoints. A cache
 * hit returns without touching D1 or KV.
 *
 * KNOWN LIMITS (Cloudflare docs, "Cache API" limitations)
 * ──────────────────────────────────────────────────────
 *  • Responses are cached only when the Worker explicitly calls `put()`.
 *  • There is no request collapsing: a burst on a cold URL still invokes the
 *    Worker once per request. This reduces D1 rows read, not Worker invocations.
 *  • Per-colo only — each Cloudflare location keeps its own copy.
 * For request collapsing/tiered caching see Workers Cache
 * (`"cache": { "enabled": true }`), which needs a wrangler upgrade (the pinned
 * 4.86.0 config schema has no `cache` key — 4.136.3 does). `Cache-Control`
 * headers alone do NOT make a Worker-generated response cacheable.
 */

/** Minimal shape we need from the Cache API — avoids relying on lib types. */
interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function defaultCache(): CacheLike | null {
  try {
    const storage = (globalThis as { caches?: { default?: unknown } }).caches;
    const cache = storage?.default as CacheLike | undefined;
    return cache && typeof cache.match === 'function' ? cache : null;
  } catch {
    return null;
  }
}

/**
 * Internal response header a handler sets to tell `edgeCachePut` "do not store
 * this one". Never sent to clients (edgeCachePut strips it).
 */
export const NO_EDGE_CACHE_HEADER = 'X-No-Edge-Cache';

/**
 * Canonical cache key: origin + path + ONLY the allow-listed query params.
 *
 * WHY: keying on the raw URL let any caller mint an unlimited number of cache
 * entries for one logical resource (`/api/topics?cb=1`, `?cb=2`, …). Each one is
 * a guaranteed miss that falls through to KV and then D1, so a single crawler
 * could bypass the edge cache entirely. Endpoints that ignore their query
 * string (topics, stats, sitemap) now key on the path alone; endpoints that read
 * a parameter (trending → `window`) list it explicitly and everything else is
 * dropped. Param order is normalised so `?a=1&b=2` and `?b=2&a=1` collide.
 */
export type KeyParams =
  | readonly string[]
  | Readonly<Record<string, (raw: string | null) => string | null>>;

export function canonicalCacheUrl(rawUrl: string, keyParams: KeyParams = []): string {
  const u = new URL(rawUrl);
  const kept = new URLSearchParams();
  const entries: Array<[string, (raw: string | null) => string | null]> = Array.isArray(keyParams)
    ? (keyParams as readonly string[]).map(n => [n, (r: string | null) => r] as [string, (r: string | null) => string | null])
    : Object.entries(keyParams as Record<string, (raw: string | null) => string | null>);
  for (const [name, normalise] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const v = normalise(u.searchParams.get(name));
    if (v !== null) kept.set(name, v);
  }
  const qs = kept.toString();
  return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
}

function cacheKey(request: Request, keyParams: KeyParams = []): Request {
  return new Request(canonicalCacheUrl(request.url, keyParams), { method: 'GET' });
}

/** Returns the cached response for this URL, or null on miss/unavailable. */
export async function edgeCacheGet(
  request: Request,
  keyParams: KeyParams = []
): Promise<Response | null> {
  const cache = defaultCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey(request, keyParams));
    return hit ?? null;
  } catch (err) {
    console.warn('[edge-cache] match failed:', err);
    return null;
  }
}

/**
 * Stores a successful response in the per-colo cache (fire-and-forget).
 * Only 200s are cached — never 429/5xx, so an outage is never cached.
 */
export function edgeCachePut(
  ctx: ExecutionContext,
  request: Request,
  response: Response,
  ttlSeconds: number,
  keyParams: KeyParams = []
): void {
  const cache = defaultCache();
  if (!cache || response.status !== 200) return;

  // A handler can veto caching for a response that is valid but must not be
  // remembered — e.g. an empty trending list, which is a symptom (stale ingest,
  // quota) rather than an answer worth serving for a full TTL. The marker is an
  // internal signal; it is stripped so it never reaches clients or the cache.
  if (response.headers.get(NO_EDGE_CACHE_HEADER) !== null) {
    response.headers.delete(NO_EDGE_CACHE_HEADER);
    // jsonResponse() stamped `public, s-maxage=…`; without this a downstream CDN
    // or browser would cache the very answer we just refused to store.
    response.headers.set('Cache-Control', 'no-store');
    return;
  }

  const headers = new Headers(response.headers);
  headers.set(
    'Cache-Control',
    `public, s-maxage=${ttlSeconds}, stale-while-revalidate=3600`
  );
  // Cache API refuses to store a response with Set-Cookie; ours never sets it,
  // but strip defensively so a future change can't silently disable caching.
  headers.delete('Set-Cookie');

  const body = response.clone().body;
  if (!body) return;

  const toStore = new Response(body, { status: response.status, headers });
  ctx.waitUntil(
    cache.put(cacheKey(request, keyParams), toStore).catch((err: unknown) => {
      console.warn('[edge-cache] put failed:', err);
    })
  );
}

/**
 * Wraps a handler with per-colo edge caching.
 *
 * Adds `X-Edge-Cache: HIT|MISS` so cache behaviour is observable from curl:
 *   curl -sI https://arxiv-api.arxivexplorer.workers.dev/api/topics | grep -i edge-cache
 *
 * NOTE: only use for anonymous, non-personalised GET responses.
 */
export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  ttlSeconds: number,
  handler: () => Promise<Response>,
  keyParams: KeyParams = []
): Promise<Response> {
  const cached = await edgeCacheGet(request, keyParams);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set('X-Edge-Cache', 'HIT');
    return hit;
  }

  const response = await handler();
  edgeCachePut(ctx, request, response, ttlSeconds, keyParams);
  response.headers.set('X-Edge-Cache', 'MISS');
  return response;
}
