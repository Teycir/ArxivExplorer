/**
 * tests/unit/trending-last-full.test.ts
 *
 * /api/trending must serve the LAST FULL list, never an empty one.
 *
 * Background (observed 2026-09-24): every trending window was empty because no
 * summarised paper was newer than 17 Aug (summarising stalled while ingest kept
 * running), and the empty `{"papers":[]}` was cached at the edge for an hour.
 * Each test below is named after the failure it must catch.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTrending } from '../../src/api-worker/routes/trending.js';
import { edgeCachePut, NO_EDGE_CACHE_HEADER } from '../../src/api-worker/cache/edge.js';
import { resetD1Breaker } from '../../src/api-worker/cache/durable.js';

const paper = (id: string) => ({ id, title: `t-${id}` });
const FULL = [paper('2509.00001'), paper('2509.00002'), paper('2509.00003')];

type DbMode = 'full' | 'empty' | 'quota' | 'boom';

function makeEnv(opts: { db: DbMode; kv?: Record<string, unknown> }) {
  const store = new Map<string, string>(Object.entries(opts.kv ?? {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts: Array<{ key: string; ttl?: number | undefined }> = [];
  const CACHE = {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string, o?: { expirationTtl?: number }) { puts.push({ key: k, ttl: o?.expirationTtl }); store.set(k, v); },
  };
  let d1Calls = 0;
  const DB = {
    prepare() {
      const s: any = {
        bind() { return s; },
        async all() {
          d1Calls++;
          // Must match the production classifier (db-budget.ts D1_DAILY_LIMIT_PATTERN),
          // otherwise the handler correctly treats it as an unrelated 500.
          if (opts.db === 'quota') throw new Error("D1_ERROR: Exceeded D1's free tier daily row read limit");
          if (opts.db === 'boom') throw new Error('D1_ERROR: something unrelated');
          return { results: opts.db === 'full' ? FULL.map(rowFor) : [], meta: { rows_read: 1 } };
        },
      };
      return s;
    },
  };
  const env = {
    CACHE, DB,
    RATE_LIMITER: { async limit() { return { success: true }; } },
    ALLOWED_ORIGIN: 'https://arxivexplorer.arxivexplorer.workers.dev',
  } as any;
  return { env, store, puts, d1: () => d1Calls };
}

// Minimal row shape that survives rowToPaper + isPaperComplete.
function rowFor(p: { id: string; title: string }) {
  return {
    id: p.id, title: p.title, abstract: 'abs', authors: '["A"]', categories: '["cs.LG"]',
    published_at: '2026-09-20', revised_at: null, pdf_url: null, html_url: null,
    indexed_at: '2026-09-20T00:00:00Z', summary_ready: 1, citation_count: 0,
    // rowToPaper only builds a summary when ALL of these are present; a row missing
    // methods/generated_at/model_version is (correctly) rejected by isPaperComplete.
    tldr: 'tl', beginner_explain: 'b', technical_summary: 't',
    key_contributions: '["k"]', methods: '["m"]', limitations: '[]',
    generated_at: '2026-09-20T00:00:00Z', model_version: 'test-model',
    follow_up_questions: '[]', entities: '[]', paper_type: 'method',
  };
}

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { c: { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as any, settle: () => Promise.all(pending) };
};
const call = async (env: any, w = 'week', ip = '10.1.1.1') => {
  const { c, settle } = ctx();
  const res = await handleTrending(new Request(`https://api.test/api/trending?window=${w}`, { headers: { 'cf-connecting-ip': ip } }), env, c);
  await settle();
  return res;
};
const body = async (r: Response) => (await r.clone().json()) as any;

describe('trending: last full, never empty', () => {
  // The D1 breaker is module-level (per isolate, until midnight UTC). Without a reset
  // one test's quota error would make every later test see "breaker open".
  beforeEach(() => resetD1Breaker());

  it('empty live window + a snapshot → serves the SNAPSHOT, marked stale with asOf', async () => {
    const { env } = makeEnv({ db: 'empty', kv: { 'kv:trending:week:lastfull': { papers: FULL, total: 3, window: 'week', asOf: '2026-08-17T00:00:00.000Z' } } });
    const res = await call(env);
    const b = await body(res);
    assert.equal(res.status, 200);
    assert.equal(b.papers.length, 3, 'served an empty list although a full snapshot existed');
    assert.equal(b.stale, true);
    assert.equal(b.asOf, '2026-08-17T00:00:00.000Z');
  });

  it('D1 QUOTA exhausted + a snapshot → serves the snapshot (200), not a 503', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { 'kv:trending:week:lastfull': { papers: FULL, total: 3, window: 'week', asOf: '2026-09-20T00:00:00.000Z' } } });
    const res = await call(env);
    assert.equal(res.status, 200, 'quota outage surfaced as an error although the last full list was available');
    assert.equal((await body(res)).papers.length, 3);
  });

  it('D1 quota exhausted and NO snapshot → still the honest 503 (no fake data)', async () => {
    const { env } = makeEnv({ db: 'quota' });
    const res = await call(env);
    assert.equal(res.status, 503);
    assert.equal((await body(res)).degraded, true);
  });

  it('empty window and NO snapshot → empty answer, but NOT remembered anywhere', async () => {
    const { env, puts } = makeEnv({ db: 'empty' });
    const res = await call(env);
    assert.equal((await body(res)).papers.length, 0);
    assert.deepEqual(puts.filter(p => p.key.startsWith('kv:trending:')), [], 'an empty list was written to KV');
    assert.equal(res.headers.get('Cache-Control'), 'no-store', 'an empty answer stayed publicly cacheable');
  });

  it('a stale answer is never edge-cacheable (recovers the moment the window fills)', async () => {
    const { env } = makeEnv({ db: 'empty', kv: { 'kv:trending:week:lastfull': { papers: FULL, total: 3, window: 'week', asOf: 'x' } } });
    const res = await call(env);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });

  it('a POISONED empty KV entry from older code is ignored, not served', async () => {
    const { env } = makeEnv({
      db: 'empty',
      kv: {
        'kv:trending:week': { papers: [], total: 0, window: 'week' },
        'kv:trending:week:lastfull': { papers: FULL, total: 3, window: 'week', asOf: '2026-08-17T00:00:00.000Z' },
      },
    });
    const b = await body(await call(env));
    assert.equal(b.papers.length, 3, 'the pre-existing empty cache entry blanked the feed');
  });

  it('a healthy live list is served fresh (not stale) and snapshotted with a 30-day TTL', async () => {
    const { env, puts } = makeEnv({ db: 'full' });
    const res = await call(env);
    const b = await body(res);
    assert.equal(b.papers.length, 3);
    assert.notEqual(b.stale, true, 'a live list was labelled stale');
    const snap = puts.find(p => p.key === 'kv:trending:week:durable');
    assert.ok(snap, 'a non-empty live list was not remembered as the last full one');
    assert.equal(snap!.ttl, 30 * 86_400);
    assert.equal(puts.some(p => p.key.endsWith(':lastfull')), false, 'the legacy key must no longer be written');
  });

  it('KV WRITE BUDGET: an unchanged live list does NOT rewrite the snapshot', async () => {
    const first = makeEnv({ db: 'full' });
    await call(first.env);
    const snapshot = first.store.get('kv:trending:week:durable')!;
    // Same list again, with the twin already present and the normal cache cold.
    const second = makeEnv({ db: 'full', kv: { 'kv:trending:week:durable': JSON.parse(snapshot) } });
    await call(second.env);
    assert.equal(second.puts.filter(p => p.key.endsWith(':durable')).length, 0, 'twin rewritten although nothing changed');
  });

  it('a CHANGED live list does refresh the snapshot', async () => {
    const older = { data: { papers: [paper('2508.99999')], total: 1, window: 'week' }, asOf: '2026-08-01T00:00:00.000Z' };
    const { env, puts } = makeEnv({ db: 'full', kv: { 'kv:trending:week:durable': older } });
    await call(env);
    assert.equal(puts.filter(p => p.key === 'kv:trending:week:durable').length, 1);
  });

  it('a NON-quota D1 failure + a snapshot → also serves the snapshot; without one it stays a 500', async () => {
    const snap = { papers: FULL, total: 3, window: 'week', asOf: '2026-09-20T00:00:00.000Z' };
    const withSnap = makeEnv({ db: 'boom', kv: { 'kv:trending:week:lastfull': snap } });
    const ok = await call(withSnap.env);
    assert.equal(ok.status, 200);
    assert.equal((await body(ok)).stale, true);

    const without = makeEnv({ db: 'boom' });
    assert.equal((await call(without.env)).status, 500, 'an unrelated D1 error must not be masked when there is nothing to serve');
  });

  it('COST: while the window stays empty, every request re-queries D1 (measured, so it is a known tradeoff)', async () => {
    // An empty list is no longer cached, so an empty window is not absorbed by the
    // cache. This pins the behaviour so a change to it is a deliberate decision.
    const { env, d1 } = makeEnv({ db: 'empty', kv: { 'kv:trending:week:lastfull': { papers: FULL, total: 3, window: 'week', asOf: 'x' } } });
    for (let i = 0; i < 5; i++) await call(env, 'week', `10.2.2.${i}`);
    assert.equal(d1(), 5, 'expected one D1 query per request while the live window is empty');
  });

  it('each window has its own snapshot (day never serves week data)', async () => {
    const { env } = makeEnv({ db: 'empty', kv: { 'kv:trending:week:lastfull': { papers: FULL, total: 3, window: 'week', asOf: 'x' } } });
    const b = await body(await call(env, 'day'));
    assert.equal(b.papers.length, 0, 'the day window served the week snapshot');
  });

  it('a corrupt/empty snapshot is not served as "full"', async () => {
    const { env } = makeEnv({ db: 'empty', kv: { 'kv:trending:week:lastfull': { papers: [], total: 0, window: 'week', asOf: 'x' } } });
    assert.equal((await body(await call(env))).papers.length, 0);
  });
});

describe('trending: folded into durable.ts', () => {
  beforeEach(() => resetD1Breaker());
  const LEGACY = { papers: FULL, total: 3, window: 'week', asOf: '2026-08-17T00:00:00.000Z' };

  it('PAGE CONTRACT: a stale body carries BOTH legacy `stale`/`asOf` and the generic notice', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { 'kv:trending:week:lastfull': LEGACY } });
    const b = await body(await call(env));
    // What app/page.tsx, explore and RssAbstractFeed read today:
    assert.equal(b.stale, true);
    assert.equal(b.asOf, LEGACY.asOf);
    // What every other route (and API consumers) read:
    assert.equal(b.cache, 'stale');
    assert.equal(b.reason, 'd1_quota');
    assert.ok(b.retryAfter >= 60);
  });

  it('an EMPTY window on a healthy D1 says `empty_window`, with no retryAfter to promise', async () => {
    const { env } = makeEnv({ db: 'empty', kv: { 'kv:trending:week:lastfull': LEGACY } });
    const b = await body(await call(env));
    assert.equal(b.reason, 'empty_window');
    assert.equal(b.retryAfter, undefined, 'nothing resets at midnight for an empty window');
    assert.equal(b.stale, true);
  });

  it('a non-quota D1 failure says `d1_error`', async () => {
    const { env } = makeEnv({ db: 'boom', kv: { 'kv:trending:week:lastfull': LEGACY } });
    assert.equal((await body(await call(env))).reason, 'd1_error');
  });

  it('MIGRATION: production data under the OLD :lastfull key is still served', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { 'kv:trending:week:lastfull': LEGACY } });
    const b = await body(await call(env));
    assert.equal(b.papers.length, 3, 'the switch to :durable blanked a feed that had data under :lastfull');
    assert.equal(b.asOf, LEGACY.asOf, 'asOf must survive the migration, not reset to now');
  });

  it('the NEW key wins over the legacy one when both exist', async () => {
    const fresh = { data: { papers: [paper('2509.77777')], total: 1, window: 'week' }, asOf: '2026-09-22T00:00:00.000Z' };
    const { env } = makeEnv({ db: 'quota', kv: { 'kv:trending:week:lastfull': LEGACY, 'kv:trending:week:durable': fresh } });
    const b = await body(await call(env));
    assert.equal(b.papers[0].id, '2509.77777');
    assert.equal(b.asOf, fresh.asOf);
  });

  it('KV BUDGET ON DEPLOY: live list == legacy list → one move to the new key, keeping asOf, never a rewrite storm', async () => {
    const legacy = { papers: FULL, total: 3, window: 'week', asOf: '2026-09-20T00:00:00.000Z' };
    const { env, puts } = makeEnv({ db: 'full', kv: { 'kv:trending:week:lastfull': legacy } });
    await call(env);
    const twinWrites = puts.filter(p => p.key === 'kv:trending:week:durable');
    assert.equal(twinWrites.length, 1, 'the legacy copy must be carried over exactly once');
  });

  it('…and the carried-over twin keeps the ORIGINAL asOf (not "now")', async () => {
    const legacy = { papers: FULL, total: 3, window: 'week', asOf: '2026-09-20T00:00:00.000Z' };
    const { env, store } = makeEnv({ db: 'full', kv: { 'kv:trending:week:lastfull': legacy } });
    await call(env);
    assert.equal(JSON.parse(store.get('kv:trending:week:durable')!).asOf, legacy.asOf);
  });

  it('once migrated, further identical reads write NOTHING', async () => {
    const legacy = { papers: FULL, total: 3, window: 'week', asOf: '2026-09-20T00:00:00.000Z' };
    const first = makeEnv({ db: 'full', kv: { 'kv:trending:week:lastfull': legacy } });
    await call(first.env);
    const migrated = JSON.parse(first.store.get('kv:trending:week:durable')!);
    const second = makeEnv({ db: 'full', kv: { 'kv:trending:week:lastfull': legacy, 'kv:trending:week:durable': migrated } });
    await call(second.env);
    assert.equal(second.puts.filter(p => p.key.endsWith(':durable')).length, 0);
  });

  it('KV BUDGET: N consecutive requests after deploy cost ONE twin write in total, not N', async () => {
    // Drives the REAL sequence (no hand-seeded twin): the legacy copy is carried over
    // on the first request and every later request must find it and stay silent.
    const legacy = { papers: FULL, total: 3, window: 'week', asOf: '2026-09-20T00:00:00.000Z' };
    const { env, puts, store } = makeEnv({ db: 'full', kv: { 'kv:trending:week:lastfull': legacy } });
    for (let i = 0; i < 6; i++) {
      store.delete('kv:trending:week'); // the short-TTL entry lapses, so every request reaches D1 again
      await call(env, 'week', `10.8.8.${i}`);
    }
    assert.equal(puts.filter(p => p.key === 'kv:trending:week:durable').length, 1,
      'twin was rewritten on repeated identical reads — on production that is a KV write per request');
  });

  it('the ingest cron can never delete a :durable twin (reads the REAL pipeline.ts, not a copy of its list)', async () => {
    const { readFileSync } = await import('node:fs');
    const { DERIVED_COUNT_KEYS } = await import('../../src/api-worker/cache/keys.js');
    const src = readFileSync(new URL('../../src/ingest-worker/pipeline.ts', import.meta.url), 'utf8');

    // Every literal key the pipeline deletes, plus the keys it deletes via DERIVED_COUNT_KEYS.
    const literal = [...src.matchAll(/kvDelete\(env\.CACHE,\s*'([^']+)'\)/g)].map(m => m[1]!);
    const deleted = [...literal, ...DERIVED_COUNT_KEYS];
    assert.ok(deleted.length >= 6, `expected to find the pipeline's deletions, found ${deleted.length}`);

    // No prefix/list-based deletion in the pipeline: only exact keys can be removed.
    assert.equal(/CACHE\.list\(|prefix/.test(src.slice(src.indexOf('9. Invalidate KV caches'), src.indexOf('9. Invalidate KV caches') + 900)), false,
      'pipeline invalidation became prefix-based and could now remove :durable twins');

    // And no exact key it deletes is a twin key.
    for (const k of deleted) assert.equal(k.endsWith(':durable') || k.endsWith(':lastfull'), false, `pipeline deletes a twin key: ${k}`);
  });

  it('after the breaker trips, trending makes ZERO further D1 reads yet keeps serving', async () => {
    const { env, d1 } = makeEnv({ db: 'quota', kv: { 'kv:trending:week:lastfull': LEGACY } });
    await call(env);
    const after = d1();
    for (let i = 0; i < 4; i++) assert.equal((await call(env, 'week', `10.7.7.${i}`)).status, 200);
    assert.equal(d1(), after);
  });
});

describe('edge cache veto', () => {
  const stored: Request[] = [];
  const fakeCaches = { default: { async match() { return undefined; }, async put(k: Request) { stored.push(k); } } };

  it('a response marked X-No-Edge-Cache is NOT stored, and the marker never reaches clients', () => {
    (globalThis as any).caches = fakeCaches;
    stored.length = 0;
    const res = new Response('{"papers":[]}', { status: 200, headers: { [NO_EDGE_CACHE_HEADER]: '1', 'Cache-Control': 'public, s-maxage=3600' } });
    edgeCachePut({ waitUntil() {} } as any, new Request('https://api.test/api/trending?window=week'), res, 3600, ['window']);
    assert.equal(stored.length, 0, 'a vetoed response was stored in the edge cache');
    assert.equal(res.headers.get(NO_EDGE_CACHE_HEADER), null, 'internal marker leaked to the client');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });

  it('an unmarked 200 is still stored (the veto is opt-in)', () => {
    (globalThis as any).caches = fakeCaches;
    stored.length = 0;
    edgeCachePut({ waitUntil(p: Promise<unknown>) { void p; } } as any, new Request('https://api.test/api/topics'), new Response('{}', { status: 200 }), 3600);
    assert.equal(stored.length, 1);
  });
});
