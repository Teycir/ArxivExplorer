/**
 * Rate limiting middleware using Cloudflare KV
 * Token bucket with sliding window
 */

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window in seconds */
  windowSeconds: number;
  /** Lockout duration on rate limit (seconds) */
  lockoutSeconds?: number;
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
  const key = `ratelimit:${ip}`;
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
    // KV error — fail open (don't block traffic on infrastructure failure)
    console.error('[rate-limit] KV error:', err);
    return { allowed: true, count: 0 };
  }
}

/**
 * Get client IP from request headers.
 * Cloudflare Workers populate CF-Connecting-IP.
 */
export function getClientIP(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}
