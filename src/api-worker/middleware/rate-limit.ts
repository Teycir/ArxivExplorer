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

function checkInMemoryFallback(ip: string, config: RateLimitConfig): RateLimitResult {
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
  if (bucket.count > FALLBACK_MAX_REQUESTS) {
    return {
      allowed: false,
      count: bucket.count,
      resetIn: Math.ceil((bucket.windowStart + windowMs - now) / 1000),
    };
  }

  return { allowed: true, count: bucket.count };
}

/**
 * Get client IP from request headers.
 * Cloudflare Workers populate CF-Connecting-IP.
 * For requests forwarded through Next.js proxy, prefer X-Real-IP if present.
 */
export function getClientIP(request: Request): string {
  // Prefer X-Real-IP from our Next.js proxy (trusted source)
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  // Fallback to Cloudflare's header
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}

/**
 * Higher-order helper that runs a rate-limit check and returns a 429 Response
 * if the IP is over quota, or calls `handler()` otherwise.
 *
 * When `nativeLimiter` is provided (the env.RATE_LIMITER binding — see
 * wrangler.api.toml [[ratelimits]]), it is checked FIRST, before the
 * KV-backed per-route limit. It is backed by Cloudflare's own rate-limiting
 * infrastructure (the same one WAF rules use), not KV, so it keeps working
 * even during a KV outage/quota exhaustion — the exact scenario that let
 * traffic through unchecked in the Sept 2026 D1 quota incident. It uses one
 * shared global bucket per IP (not per-route) as a coarse first line of
 * defense; the existing KV limiter still provides per-route granularity.
 *
 * Usage:
 *   return withRateLimit(request, env.CACHE, { maxRequests: 60, windowSeconds: 60, namespace: 'search' }, cors, () =>
 *     handleSearchInner(request, env, ctx, cors)
 *   , env.RATE_LIMITER);
 */
export async function withRateLimit(
  request: Request,
  kv: KVNamespace,
  config: RateLimitConfig,
  cors: Record<string, string>,
  handler: () => Promise<Response>,
  nativeLimiter?: NativeRateLimiter
): Promise<Response> {
  const ip = getClientIP(request);

  // First line of defense: native binding, independent of KV.
  if (nativeLimiter) {
    try {
      const { success } = await nativeLimiter.limit({ key: `global:${ip}` });
      if (!success) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' } }
        );
      }
    } catch (err) {
      // Native limiter itself failing is unusual — log and fall through to
      // the KV-backed check rather than blocking everything.
      console.error('[rate-limit] Native RATE_LIMITER binding error:', err);
    }
  }

  const result = await checkRateLimit(kv, ip, config);

  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: result.resetIn,
      }),
      {
        status: 429,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Retry-After': String(result.resetIn ?? 60),
        },
      }
    );
  }

  return handler();
}
