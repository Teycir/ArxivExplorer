import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Known aggressive crawlers, AI training scrapers, and SEO bots that exhaust Workers free tier
const BLOCKED_BOTS = /ClaudeBot|GPTBot|ChatGPT-User|Bytespider|CCBot|PerplexityBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|SERankingBacklinksBot|Reflectionbot|Diffbot|FacebookBot|Google-Extended|cohere-ai/i;

// In-memory sliding window rate limiter per isolate
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 40;
const ipBuckets = new Map<string, { count: number; windowStart: number }>();

// Daily request circuit breaker to prevent exceeding Cloudflare's 100,000 req/day limit
const DAILY_MAX_REQUESTS = 95_000;
let dailyRequestCount = 0;
let currentDay = new Date().toISOString().slice(0, 10);

export function middleware(request: NextRequest) {
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);

  // UTC day rollover
  if (day !== currentDay) {
    currentDay = day;
    dailyRequestCount = 0;
    ipBuckets.clear();
  }

  // 1. Daily safety circuit breaker (stop before Cloudflare 100k hard 429 lockout)
  dailyRequestCount++;
  if (dailyRequestCount > DAILY_MAX_REQUESTS) {
    return new NextResponse(
      JSON.stringify({
        error: 'Daily service capacity reached. Please try again tomorrow.',
        retryAfter: 3600,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '3600',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  // 2. Reject aggressive AI scrapers and crawlers before running SSR or subrequests
  const userAgent = request.headers.get('user-agent') || '';
  if (BLOCKED_BOTS.test(userAgent)) {
    return new NextResponse(
      JSON.stringify({
        error: 'Automated AI training scrapers and aggressive crawlers are not permitted.',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      }
    );
  }

  // 3. Disallow search crawling if detected as a generic bot
  const path = request.nextUrl.pathname;
  if (path.startsWith('/search') && /bot|crawl|spider|slurp/i.test(userAgent) && !/Googlebot|bingbot/i.test(userAgent)) {
    return new NextResponse(
      JSON.stringify({ error: 'Search crawling disallowed for automated agents.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      }
    );
  }

  // 4. Per-IP Rate Limiting (mitigate DoS / aggressive scraping)
  const clientIP = request.headers.get('cf-connecting-ip') ||
                   request.headers.get('x-forwarded-for') ||
                   'unknown';

  if (clientIP !== 'unknown') {
    const bucket = ipBuckets.get(clientIP);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      ipBuckets.set(clientIP, { count: 1, windowStart: now });
    } else {
      bucket.count++;
      if (bucket.count > MAX_REQUESTS_PER_MINUTE) {
        return new NextResponse(
          JSON.stringify({
            error: 'Rate limit exceeded. Please slow down.',
            retryAfter: 60,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '60',
              'Cache-Control': 'no-store',
            },
          }
        );
      }
    }

    // Occasional cleanup of stale IP buckets to avoid memory leak
    if (ipBuckets.size > 5000) {
      for (const [ip, b] of ipBuckets.entries()) {
        if (now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
          ipBuckets.delete(ip);
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
