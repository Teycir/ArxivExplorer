/**
 * Rate limiting middleware using Cloudflare KV
 * Token bucket with sliding window
 */

/** Minimal shape of the native Workers Rate Limiting binding (see wrangler.api.toml [[ratelimits]]). */
export interface NativeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window in seconds */
  windowSeconds: number;
  /** Lockout duration on rate limit (seconds) */
  lockoutSeconds?: number;
  /** Optional namespace for the rate limit key (e.g., 'search', 'claim') */
  namespace?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests used in current window */
  count: number;
  /** Time until reset (seconds) */
  resetIn?: number;
}

/**
 * Check if IP is rate-limited.
 * Returns { allowed: true } if under limit.
 * Returns { allowed: false, count, resetIn } if rate-limited.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const namespace = config.namespace ? `${config.namespace}:` : '';
  const key = `ratelimit:${namespace}${ip}`;
  const now = Date.now();

  try {
    const stored = await kv.get<{ count: number; windowStart: number; lockedUntil?: number }>(
      key,
      'json'
    );

    // Check lockout
    if (stored?.lockedUntil && now < stored.lockedUntil) {
      return {
        allowed: false,
        count: config.maxRequests,
        resetIn: Math.ceil((stored.lockedUntil - now) / 1000),
      };
    }

    const windowMs = config.windowSeconds * 1000;
    const windowStart = stored?.windowStart ?? now;
    const isNewWindow = now - windowStart >= windowMs;

    if (isNewWindow) {
      // New window — reset counter
      await kv.put(key, JSON.stringify({ count: 1, windowStart: now }), {
        expirationTtl: config.windowSeconds,
      });
      return { allowed: true, count: 1 };
    }

    const count = (stored?.count ?? 0) + 1;

    if (count > config.maxRequests) {
      // Rate limit exceeded — trigger lockout
      const lockedUntil = now + (config.lockoutSeconds ?? config.windowSeconds) * 1000;
      await kv.put(
        key,
        JSON.stringify({ count, windowStart, lockedUntil }),
        { expirationTtl: config.lockoutSeconds ?? config.windowSeconds }
      );
      return {
        allowed: false,
        count: config.maxRequests,
        resetIn: Math.ceil((lockedUntil - now) / 1000),
      };
    }

    // Under limit — increment
    await kv.put(key, JSON.stringify({ count, windowStart }), {
      expirationTtl: config.windowSeconds,
    });
    return { allowed: true, count };
  } catch (err) {
    // KV error (e.g. daily put()/read quota exhausted) — fail CLOSED with a
    // strict per-isolate fallback instead of letting all traffic through.
    // Rationale: a KV outage is exactly the condition most likely to
    // coincide with a traffic spike or bot crawl (as it did on the incident
    // that motivated this change — KV writes failing under load), so
    // "fail open" turned the one remaining guard rail off at the worst
    // possible moment. The in-memory fallback is best-effort (resets on
    // isolate recycle, not shared across isolates) but still bounds the
    // damage a single hot isolate can do to D1 while KV is unavailable.
    console.error('[rate-limit] KV error — falling back to in-memory limiter:', err);
    return checkInMemoryFallback(ip, config);
  }
}

// ─── In-memory fallback (used only when KV itself is failing) ─────────────
// Deliberately simple and stricter than the normal KV-backed limit: this
// path only runs when the primary limiter is down, so it should err on the
// side of blocking. Not persisted, not shared across isolates/regions —
// just a local circuit breaker so one worker instance can't hammer D1
// indefinitely while KV recovers.

const FALLBACK_MAX_REQUESTS = 5;
const memoryBuckets = new Map<string, { count: number; windowStart: number }>();

function checkInMemoryFallback(
  ip: string,
  config: RateLimitConfig,
  maxRequests: number = FALLBACK_MAX_REQUESTS
): RateLimitResult {
  const namespace = config.namespace ? `${config.namespace}:` : '';
  const key = `${namespace}${ip}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  const bucket = memoryBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    memoryBuckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, count: 1 };
  }

  bucket.count++;
  if (bucket.count > maxRequests) {
    return {
      allowed: false,
      count: bucket.count,
      resetIn: Math.ceil((bucket.windowStart + windowMs - now) / 1000),
    };
  }

  return { allowed: true, count: bucket.count };
}

// ─── Internal (service-binding) traffic ──────────────────────────────────────

/**
 * Bucket for calls that arrive without any Cloudflare client header — i.e. our
 * own Next.js worker rendering pages through the `API` service binding
 * (`helper/api.ts` → `https://api-internal/…`).
 *
 * These must NOT be treated as a single client. Before this change they all
 * resolved to `'0.0.0.0'`, so every visitor and every crawler on earth shared one
 * counter: legitimate users were 429'd as soon as bots drained the bucket, and
 * raising the limit only let everyone hit D1 together.
 */
export const INTERNAL_BUCKET = 'internal';

/**
 * Ceiling for internal traffic, enforced per isolate in memory (no KV writes).
 * Page renders for many users share this bucket, so it is deliberately far above
 * real traffic — it exists to stop a runaway render loop, not to throttle users.
 * Cache API hits mean most repeated renders never reach a handler at all.
 */
const INTERNAL_MAX_REQUESTS = 5_000;

/**
 * Resolve the rate-limit identity for a request.
 *
 * SECURITY — only Cloudflare-controlled inputs are trusted:
 *   • `cf-connecting-ip` is set by the edge and cannot be forged by a client.
 *   • `x-real-ip` is honoured **only** when the caller proves it is our own
 *     Next.js worker (shared secret `INTERNAL_TOKEN` + `x-internal-auth`).
 *     This worker is publicly reachable (`workers_dev = true`), so trusting that
 *     header outright let any caller mint a fresh bucket per request.
 *   • No CF header at all ⇒ internal service-binding call (see INTERNAL_BUCKET).
 */
export function getClientIP(request: Request, internalToken?: string): string {
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;

  const realIP = request.headers.get('x-real-ip');
  const auth = request.headers.get('x-internal-auth');
  if (realIP && internalToken && auth && timingSafeEqualStr(auth, internalToken)) {
    return realIP;
  }

  return INTERNAL_BUCKET;
}

/** Constant-time string comparison for the internal-forwarding secret. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Standard 429 response. */
function rateLimitedResponse(cors: Record<string, string>, retryAfter = 60): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded. Please try again later.',
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * Runs a rate-limit check and calls `handler()` when the caller is under quota.
 *
 * ORDER OF DEFENCE
 * ────────────────
 * 1. Internal service-binding traffic → generous per-isolate in-memory ceiling.
 *    No KV writes, no shared global bucket (see INTERNAL_BUCKET).
 * 2. `nativeLimiter` (env.RATE_LIMITER — see wrangler.api.toml [[ratelimits]]).
 *    Backed by Cloudflare's own rate-limiting infrastructure, not KV, and it
 *    costs **zero KV writes**. Keyed `${namespace}:${ip}` so each route keeps its
 *    own counter. When it approves a request we return immediately and never
 *    touch KV.
 *    WHY: the KV limiter wrote a key on every request, burning the free tier's
 *    1,000 writes/day. The response cache shares that budget, so the cache
 *    silently stopped persisting and every request fell through to D1 — the
 *    mechanism behind the Sept 2026 quota outage. KV is now a fallback only.
 * 3. KV sliding window — used only when no native binding is configured, or the
 *    binding itself errored (local dev, other worker configs). checkRateLimit()
 *    fails closed into the strict in-memory limiter.
 *
 * NOTE on the native limiter: per Cloudflare's docs its counters are **per
 * Cloudflare location** and the API is "permissive, eventually consistent, and
 * intentionally designed to not be used as an accurate accounting system". It is
 * a shock absorber, not a quota guard — protection against quota exhaustion comes
 * from keeping queries cheap and cached.
 *
 * Usage:
 *   return withRateLimit(request, env.CACHE, { maxRequests: 60, windowSeconds: 60, namespace: 'search' },
 *     cors, () => handleSearchInner(request, env, ctx, cors), env.RATE_LIMITER, env.INTERNAL_TOKEN);
 */
export async function withRateLimit(
  request: Request,
  kv: KVNamespace,
  config: RateLimitConfig,
  cors: Record<string, string>,
  handler: () => Promise<Response>,
  nativeLimiter?: NativeRateLimiter,
  internalToken?: string
): Promise<Response> {
  const ip = getClientIP(request, internalToken);
  const namespace = config.namespace ? `${config.namespace}:` : '';

  // 1. Our own worker's page renders — many users, one bucket. Bound it in
  //    memory so a runaway loop can't hammer D1, without throttling real users.
  if (ip === INTERNAL_BUCKET) {
    const internal = checkInMemoryFallback(ip, config, INTERNAL_MAX_REQUESTS);
    return internal.allowed ? handler() : rateLimitedResponse(cors, internal.resetIn);
  }

  // 2. Native binding — no KV writes, keeps working when KV is exhausted.
  if (nativeLimiter) {
    try {
      const { success } = await nativeLimiter.limit({ key: `${namespace}${ip}` });
      if (!success) return rateLimitedResponse(cors, 60);
      return handler();
    } catch (err) {
      console.error('[rate-limit] Native RATE_LIMITER binding error:', err);
      // fall through to the KV-backed limiter
    }
  }

  // 3. KV fallback.
  const result = await checkRateLimit(kv, ip, config);
  if (!result.allowed) return rateLimitedResponse(cors, result.resetIn);

  return handler();
}
