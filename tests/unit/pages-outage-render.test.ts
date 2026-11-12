/**
 * tests/unit/pages-outage-render.test.ts
 *
 * REAL renders of /topic/[slug], /explore and /search under each outage flavour.
 * The property that matters most: an outage must NEVER become a 404
 * (notFound()) and must NEVER leak the raw upstream URL/message to the visitor.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ReactElement } from 'react';
import { renderWithRouter } from '../helpers/render-with-router.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const mockAll = (r: () => Response) => { globalThis.fetch = (async () => r()) as typeof fetch; };

const QUOTA = () => json({ error: 'Database read budget exhausted', degraded: true, retryAfter: 3600 }, 503, { 'Retry-After': '3600' });
const RATE  = () => json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429, { 'Retry-After': '60' });
const BOOM  = () => json({ error: 'Database error: kaboom' }, 500);

const FLAVOURS: Array<[string, () => Response, RegExp, RegExp]> = [
  ['quota 503+degraded', QUOTA, /Daily quota exhausted/,      /Temporarily unavailable/],
  ['rate limit 429',     RATE,  /Temporarily unavailable/,  /Daily quota exhausted/],
  ['upstream 500',       BOOM,  /Temporarily unavailable/,  /Daily quota exhausted/],
];

async function renderTopic(slug = 'machine-learning'): Promise<string> {
  const mod = await import('../../app/topic/[slug]/page.js');
  const tree = await (mod.default as (p: unknown) => Promise<unknown>)({ params: Promise.resolve({ slug }) });
  return renderWithRouter(tree as ReactElement);
}
async function renderExplore(): Promise<string> {
  const mod = await import('../../app/explore/page.js');
  const tree = await (mod.default as () => Promise<unknown>)();
  return renderWithRouter(tree as ReactElement);
}

describe('/topic/[slug] during an outage', () => {
  for (const [name, route, want, notWant] of FLAVOURS) {
    it(`${name}: renders the notice, NOT a 404`, async () => {
      mockAll(route);
      const html = await renderTopic();   // notFound() would throw NEXT_NOT_FOUND here
      assert.match(html, want);
      assert.doesNotMatch(html, notWant);
    });
  }

  it('a genuinely unknown topic (API 404) still 404s', async () => {
    mockAll(() => json({ error: 'Topic not found' }, 404));
    await assert.rejects(renderTopic('no-such-topic'), (e: Error) => /NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK;404/.test(e.message));
  });
});

describe('/explore during an outage', () => {
  for (const [name, route, want, notWant] of FLAVOURS) {
    it(`${name}: renders the notice`, async () => {
      mockAll(route);
      const html = await renderExplore();
      assert.match(html, want);
      assert.doesNotMatch(html, notWant);
    });
  }
});

describe('/search during an outage', () => {
  async function renderSearch(q = 'transformers'): Promise<string> {
    const mod = await import('../../app/search/page.js');
    const tree = await (mod.default as (p: unknown) => Promise<unknown>)({
      searchParams: Promise.resolve({ q }),
    });
    // Suspense boundary: resolve the async inner component ourselves.
    return renderWithRouter(tree as ReactElement);
  }
  it('does not leak the upstream URL into the page on a 429', async () => {
    mockAll(RATE);
    const html = await renderSearch();
    assert.doesNotMatch(html, /workers\.dev/, 'raw upstream URL leaked to visitors/crawlers');
    assert.doesNotMatch(html, /API 429/, 'raw upstream error string leaked');
  });
});
