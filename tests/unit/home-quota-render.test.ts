/**
 * tests/unit/home-quota-render.test.ts
 *
 * REAL render test: what HTML does a crawler (or a person) receive from `/` when
 * the API answers "quota exhausted"? Unlike quota-notice.test.ts (source scans),
 * this executes HomePage and inspects the output.
 *
 * `fetch` is mocked, so no network / wrangler / bindings are involved. On the
 * server helper/api.ts falls back from the (absent) service binding to global
 * fetch, which is what we intercept.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

type Route = (url: string) => Response;

const realFetch = globalThis.fetch;
function mockApi(route: Route) {
  globalThis.fetch = (async (input: RequestInfo | URL) => route(String(input))) as typeof fetch;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const QUOTA_503 = () =>
  json({ error: 'Database read budget exhausted', degraded: true, retryAfter: 3600 }, 503, { 'Retry-After': '3600' });

async function renderHome(): Promise<string> {
  await import('../helpers/render-stubs.mjs');
  const mod = await import('../../app/page.js');
  const tree = await (mod.default as () => Promise<unknown>)();
  return renderToStaticMarkup(tree as Parameters<typeof renderToStaticMarkup>[0]);
}

describe('HomePage when the API reports quota exhaustion', () => {
  beforeEach(() => { /* each test installs its own mock */ });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('shows "Daily quota exhausted" when BOTH legs return 503+degraded', async () => {
    mockApi(() => QUOTA_503());
    const html = await renderHome();
    assert.match(html, /Daily quota exhausted/, 'notice text missing from server-rendered HTML');
    assert.match(html, /quota exhausted/i);
  });

  it('shows the notice when ONLY /api/stats is exhausted (trending served from cache)', async () => {
    mockApi(url => url.includes('/api/stats') ? QUOTA_503() : json({ papers: [], total: 0, window: 'week' }));
    const html = await renderHome();
    assert.match(html, /Daily quota exhausted/);
  });

  it('shows the notice when ONLY /api/trending is exhausted (stats served from cache)', async () => {
    // This is the exact production state observed on 2026-09-24: /api/stats answers
    // 200 from the edge cache while /api/trending is 503 + degraded. The page must
    // show BOTH the real count and the quota message — never a bare badge.
    mockApi(url => url.includes('/api/trending')
      ? QUOTA_503()
      : json({ totalPapers: 1234, totalPapersAll: 1300, topicCounts: [] }));
    const html = await renderHome();
    assert.match(html, /Daily quota exhausted/);
    assert.match(html, /1,234 papers/, 'the cached count was dropped while trending was down');
  });

  it('a 429 shows "Temporarily unavailable" — and does NOT claim the quota is exhausted', async () => {
    // A 429 from OUR limiter is a "can't serve you right now" state, but not proof
    // that the D1 budget is gone. Claiming quota here would be a false statement.
    mockApi(() => json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429, { 'Retry-After': '60' }));
    const html = await renderHome();
    assert.match(html, /Temporarily unavailable/);
    assert.doesNotMatch(html, /Daily quota exhausted/, 'a rate-limit response was mislabelled as quota exhaustion');
  });

  it('an unrecognised upstream 5xx shows "Temporarily unavailable", never a silent empty page', async () => {
    // e.g. the message pattern in db-budget.ts stops matching after a D1 wording change.
    mockApi(() => json({ error: 'Database error: something new' }, 500));
    const html = await renderHome();
    assert.match(html, /Temporarily unavailable/);
    assert.doesNotMatch(html, /Daily quota exhausted/);
  });

  it('when legs disagree, a confirmed quota exhaustion wins over a generic outage', async () => {
    mockApi(url => url.includes('/api/stats')
      ? json({ error: 'boom' }, 500)
      : QUOTA_503());
    const html = await renderHome();
    assert.match(html, /Daily quota exhausted/);
    assert.doesNotMatch(html, /Temporarily unavailable/);
  });

  it('the stats badge itself says why the count is missing', async () => {
    mockApi(() => QUOTA_503());
    assert.match(await renderHome(), /border-l[^>]*>\s*quota exhausted/);
    mockApi(() => json({ error: 'boom' }, 500));
    assert.match(await renderHome(), /border-l[^>]*>\s*unavailable/);
  });

  it('a network failure (fetch throws) also shows an outage notice', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const html = await renderHome();
    assert.match(html, /Temporarily unavailable/, 'a thrown fetch rendered a silent empty page');
  });

  it('the badge is NEVER bare: a healthy 200 with a zero count says "count pending", not a quota claim', async () => {
    // counters table empty (before the first cron refresh) → /api/stats answers a
    // healthy 200 with totalPapers 0. That is not an outage, so it must not claim
    // one — but a bare "Index Stats" pill is the exact silent empty state we removed.
    mockApi(url => url.includes('/api/stats')
      ? json({ totalPapers: 0, totalPapersAll: 0, topicCounts: [] })
      : json({ papers: [], total: 0, window: 'week' }));
    const html = await renderHome();
    assert.match(html, /border-l[^>]*>\s*count pending/, 'badge rendered bare with a zero count');
    assert.doesNotMatch(html, /Daily quota exhausted/, 'a healthy zero count was mislabelled as quota exhaustion');
    assert.doesNotMatch(html, /Temporarily unavailable/);
  });

  it('does NOT show the notice when the API is healthy', async () => {
    mockApi(url => url.includes('/api/stats')
      ? json({ totalPapers: 4321, totalPapersAll: 4400, topicCounts: [] })
      : json({ papers: [], total: 0, window: 'week' }));
    const html = await renderHome();
    assert.doesNotMatch(html, /Daily quota exhausted/);
    assert.match(html, /4,321 papers/);
  });
});
