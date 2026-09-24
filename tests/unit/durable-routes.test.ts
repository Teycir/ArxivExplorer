/**
 * tests/unit/durable-routes.test.ts
 *
 * stats / paper / sitemap / authors / author / topic must answer 200 from the
 * durable twin when D1 is exhausted — and must NOT store twins they shouldn't.
 * Each test is named after the rule it protects.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleStats } from '../../src/api-worker/routes/stats.js';
import { handlePaper } from '../../src/api-worker/routes/paper.js';
import { handleSitemap } from '../../src/api-worker/routes/sitemap.js';
import { handleAuthors } from '../../src/api-worker/routes/authors.js';
import { handleAuthor } from '../../src/api-worker/routes/author.js';
import { handleTopic } from '../../src/api-worker/routes/topic.js';
import { resetD1Breaker, durableKey } from '../../src/api-worker/cache/durable.js';
import { KV_STATS, KV_SITEMAP, kvPaperFull, kvAuthor, kvTopic } from '../../src/api-worker/cache/keys.js';
import { makeEnv, makeCtx, nextIp, bodyOf, type Route } from '../helpers/durable-env.js';

const ASOF = '2026-09-23T10:00:00.000Z';
const twin = (data: unknown) => ({ data, asOf: ASOF });
const req = (path: string) => new Request(`https://api.test${path}`, { headers: { 'cf-connecting-ip': nextIp() } });

async function run(h: () => Promise<Response>, settle: () => Promise<unknown>) {
  const res = await h();
  await settle();
  return res;
}

beforeEach(() => resetD1Breaker());

// ─── stats ──────────────────────────────────────────────────────────────────
describe('stats', () => {
  const STATS = { totalPapers: 6681, totalPapersAll: 9800, topicCounts: [{ slug: 'llm', label: 'LLMs', count: 7 }] };
  const ROUTES = [
    { match: 'FROM counters', rows: [{ name: 'papers_ready', value: 6681 }, { name: 'papers_total', value: 9800 }] },
    { match: 'FROM topics', rows: [{ slug: 'llm', label: 'LLMs', description: null, updated_at: 'x', paper_count: 7 }] },
  ];

  it('serves the twin with the real counts (200, stale flag) when D1 is out of quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(KV_STATS)]: twin(STATS) } });
    const { c, settle } = makeCtx();
    const res = await run(() => handleStats(req('/api/stats'), env, c), settle);
    assert.equal(res.status, 200);
    const b = await bodyOf(res);
    assert.equal(b.totalPapers, 6681, 'must show the real count, not zero');
    assert.equal(b.cache, 'stale');
    assert.equal(b.reason, 'd1_quota');
  });

  it('never stores an all-zero payload as the twin (would replace real counts with 0 for 30 days)', async () => {
    const { env, store } = makeEnv({
      db: 'ok',
      routes: [{ match: 'FROM counters', rows: [] }, { match: 'FROM topics', rows: [] }],
    });
    const { c, settle } = makeCtx();
    await run(() => handleStats(req('/api/stats'), env, c), settle);
    assert.equal(store.has(durableKey(KV_STATS)), false);
  });

  it('writes the twin after a healthy read', async () => {
    const { env, store } = makeEnv({ db: 'ok', routes: ROUTES });
    const { c, settle } = makeCtx();
    const res = await run(() => handleStats(req('/api/stats'), env, c), settle);
    assert.equal((await bodyOf(res)).cache, undefined);
    assert.ok(store.has(durableKey(KV_STATS)));
  });
});

// ─── paper ──────────────────────────────────────────────────────────────────
describe('paper', () => {
  const ID = '2509.00001';
  const row = (ready: number) => ({
    id: ID, title: 't', abstract: 'a', authors: '["A"]', categories: '["cs.LG"]',
    published_at: '2026-09-20', revised_at: null, pdf_url: null, html_url: null,
    indexed_at: '2026-09-20T00:00:00Z', summary_ready: ready, citation_count: 0,
    tldr: 'tl', beginner_explain: 'b', technical_summary: 't',
    key_contributions: '["k"]', methods: '["m"]', limitations: '[]',
    generated_at: '2026-09-20T00:00:00Z', model_version: 'm',
    follow_up_questions: '[]', entities: '[]', paper_type: 'method',
  });
  const call = (env: any) => {
    const { c, settle } = makeCtx();
    return run(() => handlePaper(req(`/api/paper/${ID}`), env, c, ID), settle);
  };

  it('serves the stored copy when D1 is out of quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(kvPaperFull(ID))]: twin({ id: ID, title: 'cached' }) } });
    const res = await call(env);
    assert.equal(res.status, 200);
    const b = await bodyOf(res);
    assert.equal(b.title, 'cached');
    assert.equal(b.cache, 'stale');
  });

  it('gets a twin for a COMPLETE paper (summary_ready=1)', async () => {
    const { env, store } = makeEnv({ db: 'ok', routes: [{ match: 'FROM papers', rows: [row(1)] }] });
    await call(env);
    assert.ok(store.has(durableKey(kvPaperFull(ID))));
  });

  it('never gets a twin for a PENDING paper (summary_ready=0) — it would freeze for 30 days', async () => {
    const { env, store } = makeEnv({ db: 'ok', routes: [{ match: 'FROM papers', rows: [row(0)] }] });
    await call(env);
    assert.equal(store.has(durableKey(kvPaperFull(ID))), false);
  });

  it('never gets a twin for a FAILED paper (summary_ready=2)', async () => {
    const { env, store } = makeEnv({ db: 'ok', routes: [{ match: 'FROM papers', rows: [row(2)] }] });
    await call(env);
    assert.equal(store.has(durableKey(kvPaperFull(ID))), false);
  });

  it('an unknown paper is a real 404, not a stale answer', async () => {
    const { env } = makeEnv({ db: 'ok', routes: [{ match: 'FROM papers', rows: [] }] });
    assert.equal((await call(env)).status, 404);
  });

  it('with no twin, a quota outage is still an honest 503', async () => {
    const { env } = makeEnv({ db: 'quota' });
    assert.equal((await call(env)).status, 503);
  });
});

// ─── sitemap ────────────────────────────────────────────────────────────────
describe('sitemap', () => {
  const XML = '<?xml version="1.0"?><urlset><url><loc>https://x/paper/1</loc><lastmod>2026-09-23</lastmod></url></urlset>';
  const ROUTES: Route[] = [
    { match: 'FROM papers', rows: [{ id: '2509.00001', title: 't', abstract: 'a', summary_ready: 1, tldr: 'x', beginner_explain: 'x', technical_summary: 'x', key_contributions: '["k"]' }] },
    { match: 'FROM topics', rows: [{ slug: 'llm', label: 'LLMs', updated_at: 'x' }] },
  ];
  const call = (env: any) => {
    const { c, settle } = makeCtx();
    return run(() => handleSitemap(req('/api/sitemap'), env, c), settle);
  };

  it('serves the last good sitemap as XML (200) when D1 is out of quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(KV_SITEMAP)]: twin(XML) } });
    const res = await call(env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type') ?? '', /xml/);
    assert.equal(await res.text(), XML, 'crawlers must get the XML untouched');
    assert.equal(res.headers.get('X-Data-Source'), 'durable-cache');
  });

  it('does not rewrite an unchanged twin when only <lastmod> moved (KV budget)', async () => {
    const { env, puts, store } = makeEnv({ db: 'ok', routes: ROUTES });
    await call(env);
    const first = puts.filter(p => p.key === durableKey(KV_SITEMAP)).length;
    assert.equal(first, 1);
    // A later day: the live entry lapsed, D1 answers with the same URLs, only the date differs.
    store.delete(KV_SITEMAP);
    const stored = JSON.parse(store.get(durableKey(KV_SITEMAP))!);
    stored.data = stored.data.replace(/<lastmod>[^<]*<\/lastmod>/g, '<lastmod>2000-01-01</lastmod>');
    store.set(durableKey(KV_SITEMAP), JSON.stringify(stored));
    await call(env);
    assert.equal(puts.filter(p => p.key === durableKey(KV_SITEMAP)).length, 1, 'a date change alone must cost no KV write');
  });

  it('rewrites the twin when the URL set actually changes', async () => {
    const first = makeEnv({ db: 'ok', routes: ROUTES });
    await call(first.env);
    assert.doesNotMatch(first.store.get(durableKey(KV_SITEMAP))!, /2509\.00002/);

    // Later: the live entry has lapsed and D1 now knows one more paper. Same KV, new D1 rows.
    first.store.delete(KV_SITEMAP);
    const extra = { ...(ROUTES[0]!.rows[0] as Record<string, unknown>), id: '2509.00002' };
    const grown: Route[] = [{ match: 'FROM papers', rows: [...ROUTES[0]!.rows, extra] }, ROUTES[1]!];
    const second = makeEnv({ db: 'ok', routes: grown, kv: Object.fromEntries(first.store) });
    await call(second.env);

    assert.match(second.store.get(durableKey(KV_SITEMAP))!, /2509\.00002/, 'a new URL never reached the twin');
    assert.equal(second.puts.filter(p => p.key === durableKey(KV_SITEMAP)).length, 1);
  });

  it('never stores a sitemap with no paper URLs (a symptom, not a sitemap)', async () => {
    const { env, store } = makeEnv({ db: 'ok', routes: [{ match: 'FROM papers', rows: [] }, { match: 'FROM topics', rows: [] }] });
    await call(env);
    assert.equal(store.has(durableKey(KV_SITEMAP)), false);
  });
});

// ─── authors (list) ─────────────────────────────────────────────────────────
describe('authors', () => {
  const LIST = { authors: [{ name: 'Ada', paperCount: 3 }], total: 1 };
  const key = 'authors:200:';
  const call = (env: any, q = '') => {
    const { c, settle } = makeCtx();
    return run(() => handleAuthors(req(`/api/authors${q}`), env, c), settle);
  };

  it('serves the plain list from the twin when D1 is out of quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(key)]: twin(LIST) } });
    const res = await call(env);
    assert.equal(res.status, 200);
    assert.equal((await bodyOf(res)).cache, 'stale');
  });

  it('a SEARCH is never served from a twin (unbounded queries) — honest 503', async () => {
    // A twin exists under the search request's OWN key as well, so the only thing
    // that can produce the 503 is the `!search` guard — not a key that happens to miss.
    const { env } = makeEnv({
      db: 'quota',
      kv: { [durableKey(key)]: twin(LIST), [durableKey('authors:200:ada')]: twin(LIST) },
    });
    const res = await call(env, '?search=ada');
    assert.equal(res.status, 503, 'a search must not be answered from any stored list');
  });

  it('a search result is never WRITTEN as a twin either', async () => {
    const { env, store } = makeEnv({
      db: 'ok',
      routes: [{ match: 'authors', rows: [{ name: 'Ada', paper_count: 3, total_citations: 0, categories: '[]', latest_paper: 'x' }] }],
    });
    await call(env, '?search=ada');
    assert.equal(store.has(durableKey('authors:200:ada')), false);
  });
});

// ─── author (one) ───────────────────────────────────────────────────────────
describe('author', () => {
  const NAME = 'Ada Lovelace';
  const PAYLOAD = { author: NAME, papers: [{ id: '1' }], total: 1, stats: {} };
  const call = (env: any) => {
    const { c, settle } = makeCtx();
    return run(() => handleAuthor(req(`/api/author/${encodeURIComponent(NAME)}`), env, c, encodeURIComponent(NAME)), settle);
  };

  it('serves the stored author page when D1 is out of quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(kvAuthor(NAME))]: twin(PAYLOAD) } });
    const res = await call(env);
    assert.equal(res.status, 200);
    const b = await bodyOf(res);
    assert.equal(b.author, NAME);
    assert.equal(b.cache, 'stale');
  });

  it('with no twin, an author page is an honest 503', async () => {
    const { env } = makeEnv({ db: 'quota' });
    assert.equal((await call(env)).status, 503);
  });
});

// ─── topic (one) ────────────────────────────────────────────────────────────
describe('topic', () => {
  const SLUG = 'llm';
  const PAYLOAD = { topic: { slug: SLUG, label: 'LLMs' }, papers: [{ id: '1' }], total: 1 };
  const call = (env: any) => {
    const { c, settle } = makeCtx();
    return run(() => handleTopic(req(`/api/topic/${SLUG}`), env, c, SLUG), settle);
  };

  it('serves the stored topic page when D1 is out of quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(kvTopic(SLUG))]: twin(PAYLOAD) } });
    const res = await call(env);
    assert.equal(res.status, 200);
    assert.equal((await bodyOf(res)).cache, 'stale');
  });

  it('a D1 outage is NEVER reported as "Topic not found" (404) — no twin gives 503', async () => {
    const { env } = makeEnv({ db: 'quota' });
    const res = await call(env);
    assert.equal(res.status, 503);
  });

  it('a topic that genuinely does not exist is still a 404', async () => {
    const { env } = makeEnv({ db: 'ok', routes: [{ match: 'FROM topics', rows: [] }] });
    assert.equal((await call(env)).status, 404);
  });
});
