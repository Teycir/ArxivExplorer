import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { logAttack, type AttackLogContext, type Decision } from './log/attack-log';

// Known aggressive crawlers, AI training scrapers, and SEO bots that exhaust Workers free tier
const BLOCKED_BOTS = /ClaudeBot|GPTBot|ChatGPT-User|Bytespider|CCBot|PerplexityBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|SERankingBacklinksBot|Reflectionbot|Diffbot|FacebookBot|Google-Extended|cohere-ai/i;

// Obvious-bot scoring: cheap header/path heuristics only, no fingerprinting.
const BOT_UA = /bot|crawl|spider|scrape|headless|phantom|selenium|puppeteer|playwright|curl|wget|python-requests|go-http-client|okhttp|libwww|httpclient|node-fetch/i;
const SCANNER_PATH = /^\/(wp-|wordpress|xmlrpc\.php|\.env|\.git|phpmyadmin|admin|administrator|cgi-bin|vendor\/|config\.|backup|db\.|sql|shell|actuator|\.aws|\.ssh)/i;
const BOT_BURST_THRESHOLD = 60;            // req/min from one IP before a bot is blocked outright
const BOT_BLOCK_MS = 60 * 60 * 1000;       // 1h block
const blockedIps = new Map<string, number>(); // ip -> unblock timestamp

function botScore(request: NextRequest, ua: string): number {
  let s = 0;
  if (!ua || ua.length < 12) s += 3;
  else if (BOT_UA.test(ua)) s += 2;
  if (!request.headers.get('accept-language')) s += 1;
  const accept = request.headers.get('accept') || '';
  if (!accept.includes('text/html') && !accept.includes('application/json')) s += 1;
  if (request.method === 'HEAD') s += 1;
  if (SCANNER_PATH.test(request.nextUrl.pathname)) s += 2;
  return s;
}

// In-memory sliding window rate limiter per isolate
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const SOFT_LIMIT_PER_MINUTE = 80;   // Start silent progressive slowdown (traffic pacing)
const MAX_REQUESTS_PER_MINUTE = 150; // Hard ceiling to stop abusive floods
const ipBuckets = new Map<string, { count: number; windowStart: number }>();

// --- Turnstile gate -------------------------------------------------------
// Anonymous clients get one challenge, then a signed 30-day cookie. Crawlers
// that do not run JS never get past their first URL. Fails open when unset.
const TS_COOKIE = 'ts_pass';
const TS_TTL_S = 30 * 24 * 3600;
const TS_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Real search engines must stay crawlable or the site loses its only organic traffic.
const SEARCH_ENGINES = /Googlebot|bingbot|DuckDuckBot|Applebot|YandexBot|Baiduspider|Slurp/i;
// One-request-per-bot endpoints; challenging these only breaks crawlers.
const TS_EXEMPT = /^\/(robots\.txt|sitemap\.xml|rss\.xml|llms\.txt|ai\.txt)$/;
// Served by the assets layer before the worker; never worth a challenge.
const TS_STATIC = /\.(svg|png|jpe?g|gif|webp|avif|ico|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm)$/i;

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function validPass(cookie: string, secret: string): Promise<boolean> {
  const [exp, sig] = cookie.split('.');
  if (!exp || !sig) return false;
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN * 1000 < Date.now()) return false;
  return timingSafeEq(sig, await hmacHex(secret, `v1.${exp}`));
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const r = await fetch(TS_VERIFY_URL, { method: 'POST', body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}

function challengeHtml(siteKey: string, failed: boolean): string {
  const key = siteKey.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Verify — ArxivCSExplorer</title>
<style>
body{background:#050505;color:#e4e4e7;font-family:ui-monospace,Menlo,monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{max-width:24rem;text-align:center;border:1px solid #27272a;border-radius:.75rem;padding:2rem 1.5rem;background:#0c0c0f}
h1{font-size:1.05rem;margin:0 0 .5rem}p{font-size:.72rem;color:#8a8a93;line-height:1.6;margin:0 0 1.25rem}
.e{color:#ef4444;font-size:.7rem;margin:0 0 .75rem}
</style></head>
<body><div class="c">
<h1>Quick check</h1>
${failed ? '<p class="e">Verification failed. Try again.</p>' : ''}
<p>Bots are eating this site's free daily quota. One check, then 30 days of normal access.</p>
<script>function tsPass(t){var u=new URL(location.href);u.searchParams.set('cf-turnstile-response',t);location.replace(u.toString())}</script>
<div class="cf-turnstile" data-sitekey="${key}" data-callback="tsPass" data-theme="dark"></div>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</body></html>`;
}

async function turnstileGate(request: NextRequest): Promise<NextResponse | null> {
  const siteKey = process.env.TURNSTILE_SITE_KEY || '';
  const secret = process.env.TURNSTILE_SECRET || '';
  if (!siteKey || !secret) return null; // not configured yet: no-op

  const path = request.nextUrl.pathname;
  if (TS_EXEMPT.test(path)) return null;
  if (SEARCH_ENGINES.test(request.headers.get('user-agent') || '')) return null;

  // Gate navigations by default: a client that omits Accept is not a browser.
  const isStatic = TS_STATIC.test(path);
  const isRsc = request.headers.has('rsc') || request.nextUrl.searchParams.has('_rsc');
  const wantsApi = path.startsWith('/api/');
  if (isStatic && !wantsApi) return null;

  const cookie = request.cookies.get(TS_COOKIE)?.value || '';
  if (cookie && (await validPass(cookie, secret))) return null;

  const isPrefetch =
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-purpose') === 'prefetch' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('sec-purpose') === 'prefetch';
  // Speculative fetches from unverified clients are dropped, never charged a challenge.
  if (isPrefetch) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  const token = request.nextUrl.searchParams.get('cf-turnstile-response');
  if (token && request.method === 'GET') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (await verifyTurnstile(secret, token, ip)) {
      const url = new URL(request.url);
      url.searchParams.delete('cf-turnstile-response');
      const exp = Math.floor(Date.now() / 1000) + TS_TTL_S;
      const sig = await hmacHex(secret, `v1.${exp}`);
      return new NextResponse(null, {
        status: 303,
        headers: {
          Location: url.toString(),
          'Set-Cookie': `${TS_COOKIE}=${exp}.${sig}; Path=/; Max-Age=${TS_TTL_S}; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  if (wantsApi || isRsc) {
    return new NextResponse(JSON.stringify({ error: 'challenge_required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Challenge': 'turnstile' },
    });
  }

  return new NextResponse(challengeHtml(siteKey, Boolean(token)), {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '3600',
      'X-Robots-Tag': 'noindex',
      // api.js contains the regional/fed alternates, so allow them too:
      // challenges.cloudflare-cn.com and challenges.fed.cloudflare.com.
      'Content-Security-Policy':
        "default-src 'none'; " +
        "script-src 'unsafe-inline' https://challenges.cloudflare.com https://challenges.cloudflare-cn.com https://challenges.fed.cloudflare.com; " +
        "frame-src https://challenges.cloudflare.com https://challenges.cloudflare-cn.com https://challenges.fed.cloudflare.com; " +
        "connect-src https://challenges.cloudflare.com https://challenges.cloudflare-cn.com https://challenges.fed.cloudflare.com; " +
        "style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
    },
  });
}

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
  const startedAt = Date.now();

  let cfCtx: AttackLogContext | null = null;
  try {
    cfCtx = getCloudflareContext({ async: false }) as unknown as AttackLogContext;
  } catch {
    cfCtx = null;
  }

  const now = startedAt;
  const day = new Date().toISOString().slice(0, 10);
  const path = request.nextUrl.pathname;
  const userAgent = request.headers.get('user-agent') || '';
  const clientIP = (request.headers.get('cf-connecting-ip') ||
                    (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
                    '');

  const logExit = (
    decision: Decision,
    status: number,
    extra: Partial<{ score: number; count: number }> = {}
  ) =>
    logAttack(cfCtx, {
      decision,
      ip: clientIP,
      method: request.method,
      path: path + request.nextUrl.search,
      ua: userAgent,
      status,
      ms: Date.now() - startedAt,
      ...extra,
    });

  // /_next/image is unused (no <Image> in app/) and is an unauthenticated,
  // unbounded, CPU-heavy URL surface: url= + w= are attacker-controlled.
  // It is excluded from the matcher's auth paths, so kill it here, cheaply.
  if (path.startsWith('/_next/image')) {
    logExit('image_404', 404);
    return new Response(null, { status: 404 });
  }

  // UTC day rollover
  if (day !== currentDay) {
    currentDay = day;
    dailyRequestCount = 0;
    ipBuckets.clear();
    blockedIps.clear();
  }

  // 0. Blocked-IP fast path: one map lookup, no SSR, no subrequest.
  if (clientIP) {
    const until = blockedIps.get(clientIP);
    if (until && until > now) {
      logExit('blocked_ip', 403);
      return new NextResponse(null, {
        status: 403,
        headers: { 'Retry-After': '3600', 'Cache-Control': 'no-store' },
      });
    }
    if (until) blockedIps.delete(clientIP);
  }

  // 1. Daily safety circuit breaker (stop before Cloudflare 100k hard 429 lockout)
  dailyRequestCount++;
  if (dailyRequestCount > DAILY_MAX_REQUESTS) {
    logExit('daily_429', 429);
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
  if (BLOCKED_BOTS.test(userAgent)) {
    logExit('bot_ua', 403);
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

  // 3. Turnstile: anonymous HTML/API clients prove once, then carry a signed cookie
  const tsGate = await turnstileGate(request);
  if (tsGate) {
    logExit('ts_challenge', tsGate.status);
    return tsGate;
  }

  // 4. Disallow search crawling if detected as a generic bot
  if (path.startsWith('/search') && /bot|crawl|spider|slurp/i.test(userAgent) && !/Googlebot|bingbot/i.test(userAgent)) {
    logExit('bot_ua', 403);
    return new NextResponse(
      JSON.stringify({ error: 'Search crawling disallowed for automated agents.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      }
    );
  }

  // 5. Per-IP Rate Limiting & Traffic Shaping (Silent Slowing Down)
  // Check if this is an automatic background prefetch from Next.js Link
  const isPrefetch =
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('x-purpose') === 'prefetch' ||
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('sec-purpose') === 'prefetch';

  if (clientIP) {
    const bucket = ipBuckets.get(clientIP);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      ipBuckets.set(clientIP, { count: isPrefetch ? 0 : 1, windowStart: now });
    } else {
      // Do not penalize human visitors for automatic background link prefetches
      if (!isPrefetch) {
        bucket.count++;
      }

      // 4a0. Burst from one IP + obvious-bot signals => block now, do not pace.
      if (!isPrefetch && bucket.count > BOT_BURST_THRESHOLD) {
        const score = botScore(request, userAgent);
        if (score >= 3 && !SEARCH_ENGINES.test(userAgent)) {
          blockedIps.set(clientIP, now + BOT_BLOCK_MS);
          if (blockedIps.size > 2000) {
            for (const [ip, t] of blockedIps) if (t <= now) blockedIps.delete(ip);
          }
          logExit('bot_burst', 403, { score, count: bucket.count });
          return new NextResponse(null, {
            status: 403,
            headers: { 'Retry-After': '3600', 'Cache-Control': 'no-store' },
          });
        }
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

        logExit('rate_429', 429, { count: bucket.count });
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

  if (Math.random() < 0.02) logExit('ok_sample', 200);

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - favicon.ico (favicon file)
     * - static assets
     */
    '/((?!_next/static|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
