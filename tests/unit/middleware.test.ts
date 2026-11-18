/**
 * tests/unit/middleware.test.ts
 *
 * Verifies the edge middleware that protects ArxivExplorer from:
 * 1. Aggressive AI training scrapers and crawlers (ClaudeBot, GPTBot, etc.)
 * 2. Rapid-fire request bursts per IP (rate limiting & pacing)
 * 3. Daily request ceiling circuit breaker (< 100,000 requests/day)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware.js';

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, 'https://arxivexplorer.arxivexplorer.workers.dev'), {
    headers: new Headers(headers),
  });
}

describe('edge middleware bot blocking', () => {
  const BLOCKED_BOTS = [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)',
    'Bytespider',
    'CCBot/2.0',
    'PerplexityBot/1.0',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'AhrefsBot/7.0',
    'DotBot/1.2',
    'PetalBot',
    'SERankingBacklinksBot/1.0',
    'Reflectionbot/1.0',
  ];

  for (const bot of BLOCKED_BOTS) {
    it(`blocks known scraper: ${bot.slice(0, 30)}...`, async () => {
      const req = makeRequest('/', { 'user-agent': bot });
      const res = await middleware(req);
      assert.equal(res.status, 403, `expected 403 Forbidden for bot: ${bot}`);
    });
  }

  it('allows legitimate human browser traffic', async () => {
    const req = makeRequest('/', {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    const res = await middleware(req);
    assert.equal(res.status, 200); // NextResponse.next() defaults to status 200 in Next.js
  });

  it('blocks generic crawler bots from crawling /search', async () => {
    const req = makeRequest('/search?q=machine+learning', {
      'user-agent': 'MySpider/1.0',
    });
    const res = await middleware(req);
    assert.equal(res.status, 403, 'crawler should not be allowed to crawl /search');
  });

  it('allows Googlebot to crawl non-blocked pages', async () => {
    const req = makeRequest('/topic/llms', {
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
    const res = await middleware(req);
    assert.equal(res.status, 200);
  });
});

describe('edge middleware per-IP rate limiting', () => {
  it('throttles rapid requests from the same IP', async () => {
    const ip = '198.51.100.99';
    let throttled = false;

    for (let i = 0; i < 160; i++) {
      const req = makeRequest('/', {
        'cf-connecting-ip': ip,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      const res = await middleware(req);
      if (res.status === 429) {
        throttled = true;
        assert.ok(res.headers.get('Retry-After'));
        break;
      }
    }

    assert.ok(throttled, 'expected IP sending > 150 req/min to be throttled to 429');
  });

  it('blocks an obvious-bot IP on a >60 req/min burst and keeps it blocked', async () => {
    const ip = '198.51.100.210';
    let blocked = false;

    for (let i = 0; i < 70; i++) {
      const req = makeRequest('/', { 'cf-connecting-ip': ip, 'user-agent': '' });
      const res = await middleware(req);
      if (res.status === 403) {
        blocked = true;
        assert.equal(res.headers.get('Retry-After'), '3600');
        break;
      }
    }
    assert.ok(blocked, 'expected UA-less burst to be blocked with 403');

    // Blocked fast path must win even with a browser-like UA afterwards.
    const followUp = makeRequest('/', {
      'cf-connecting-ip': ip,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const res = await middleware(followUp);
    assert.equal(res.status, 403);
  });

  it('does not penalize automatic background link prefetches', async () => {
    const ip = '198.51.100.100';

    // Send 100 prefetch requests
    for (let i = 0; i < 100; i++) {
      const req = makeRequest('/paper/test', {
        'cf-connecting-ip': ip,
        'purpose': 'prefetch',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      const res = await middleware(req);
      assert.equal(res.status, 200);
    }

    // Normal page request should still succeed immediately
    const normalReq = makeRequest('/', {
      'cf-connecting-ip': ip,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const normalRes = await middleware(normalReq);
    assert.equal(normalRes.status, 200);
  });
});

// Keep this block LAST: once the breaker trips, every later call in this module
// instance is a 429 until the UTC day rolls over.
describe('edge middleware daily request circuit breaker', () => {
  it('trips with 429 + Retry-After before the 100,000 req/day Cloudflare wall', async () => {
    let firstTrip = -1;

    for (let i = 1; i <= 100_000; i++) {
      // No client IP header → per-IP limiter is skipped, only the daily counter runs.
      const res = await middleware(makeRequest('/', {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }));
      if (res.status === 429) {
        firstTrip = i;
        assert.equal(res.headers.get('Retry-After'), '3600');
        assert.equal(res.headers.get('Cache-Control'), 'no-store');
        break;
      }
    }

    assert.ok(firstTrip > 0, 'breaker never tripped within 100,000 requests');
    assert.ok(firstTrip <= 95_001, `breaker tripped too late (request ${firstTrip})`);
    assert.ok(firstTrip >= 94_000, `breaker tripped suspiciously early (request ${firstTrip})`);
  });
});
