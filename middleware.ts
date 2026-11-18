import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Known aggressive crawlers, AI training scrapers, and SEO bots that exhaust Workers free tier
const BLOCKED_BOTS = /ClaudeBot|GPTBot|ChatGPT-User|Bytespider|CCBot|PerplexityBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|SERankingBacklinksBot|Reflectionbot|Diffbot|FacebookBot|Google-Extended|cohere-ai/i;

// In-memory sliding window rate limiter per isolate
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const SOFT_LIMIT_PER_MINUTE = 80;   // Start silent progressive slowdown (traffic pacing)
const MAX_REQUESTS_PER_MINUTE = 150; // Hard ceiling to stop abusive floods
const ipBuckets = new Map<string, { count: number; windowStart: number }>();

// Daily request circuit breaker to prevent exceeding Cloudflare's 100,000 req/day limit
const DAILY_MAX_REQUESTS = 95_000;
let dailyRequestCount = 0;
let currentDay = new Date().toISOString().slice(0, 10);

function buildHtmlPacingPage(retryAfter = 5): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pacing Down — ArxivCSExplorer</title>
  <meta http-equiv="refresh" content="${retryAfter}"/>
  <style>
    body {
      background-color: #050505;
      color: #e4e4e7;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
      box-sizing: border-box;
    }
    .card {
      max-width: 26rem;
      width: 100%;
      background: rgba(18, 18, 22, 0.9);
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 0.75rem;
      padding: 2.25rem 1.75rem;
      text-align: center;
      box-shadow: 0 0 35px rgba(239, 68, 68, 0.08);
    }
    .badge {
      display: inline-block;
      font-size: 0.65rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.2rem;
      font-weight: 700;
      color: #f4f4f5;
      margin: 0 0 0.75rem 0;
    }
    p {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.55);
      line-height: 1.6;
      margin: 0 0 1.5rem 0;
    }
    .btn {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-decoration: none;
      padding: 0.5rem 1.25rem;
      border-radius: 0.5rem;
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
      cursor: pointer;
    }
    .btn:hover {
      background: rgba(239, 68, 68, 0.18);
      border-color: #ef4444;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Traffic Pacing</div>
    <h1>Taking a quick breath...</h1>
    <p>
      You are exploring papers at lightning speed. We are briefly pacing requests to keep the free service smooth for everyone.
    </p>
    <a href="javascript:location.reload()" class="btn">Resume Exploring</a>
  </div>
</body>
</html>`;
}

export async function middleware(request: NextRequest) {
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
    const acceptsHtml = request.headers.get('accept')?.includes('text/html');
    if (acceptsHtml) {
      return new NextResponse(
        `<!DOCTYPE html><html><body style="background:#09090b;color:#eee;font-family:monospace;padding:2rem;text-align:center;"><h1>Capacity reached</h1><p>Daily service capacity reached. Please try again tomorrow.</p></body></html>`,
        {
          status: 429,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Retry-After': '3600',
            'Cache-Control': 'no-store',
          },
        }
      );
    }
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

  // 4. Per-IP Rate Limiting & Traffic Shaping (Silent Slowing Down)
  // Check if this is an automatic background prefetch from Next.js Link
  const isPrefetch =
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-purpose') === 'prefetch' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('sec-purpose') === 'prefetch';

  const clientIP = request.headers.get('cf-connecting-ip') ||
                   request.headers.get('x-forwarded-for') ||
                   'unknown';

  if (clientIP !== 'unknown') {
    const bucket = ipBuckets.get(clientIP);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      ipBuckets.set(clientIP, { count: isPrefetch ? 0 : 1, windowStart: now });
    } else {
      // Do not penalize human visitors for automatic background link prefetches
      if (!isPrefetch) {
        bucket.count++;
      }

      // 4a. Silent progressive slowdown: smoothly pace rapid human navigation
      if (bucket.count > SOFT_LIMIT_PER_MINUTE && bucket.count <= MAX_REQUESTS_PER_MINUTE) {
        const isTest = typeof process !== 'undefined' && (
          process.env.NODE_ENV === 'test' ||
          Boolean(process.env.NODE_TEST_CONTEXT)
        );
        if (!isTest) {
          const delayMs = Math.min(600, (bucket.count - SOFT_LIMIT_PER_MINUTE) * 12);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      // 4b. Hard ceiling: handle excessive traffic gracefully without raw JSON alert
      if (bucket.count > MAX_REQUESTS_PER_MINUTE) {
        if (isPrefetch) {
          // Quietly drop excessive speculative prefetches without affecting page UI
          return new NextResponse(null, {
            status: 204,
            headers: { 'Retry-After': '10', 'Cache-Control': 'no-store' },
          });
        }

        const isRsc = request.headers.has('rsc') || request.nextUrl.searchParams.has('_rsc');
        const acceptsHtml = request.headers.get('accept')?.includes('text/html');

        // Human visitor viewing an HTML page directly
        if (acceptsHtml && !isRsc) {
          return new NextResponse(buildHtmlPacingPage(5), {
            status: 429,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Retry-After': '5',
              'Cache-Control': 'no-store',
            },
          });
        }

        // Client-side RSC navigation
        if (isRsc) {
          return new NextResponse('Rate limit exceeded. Pacing down.', {
            status: 429,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Retry-After': '5',
              'Cache-Control': 'no-store',
            },
          });
        }

        // API or programmatic request
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
