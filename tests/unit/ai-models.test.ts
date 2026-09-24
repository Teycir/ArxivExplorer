/**
 * tests/unit/ai-models.test.ts
 *
 * Guards the fix for the Aug–Sep 2026 summary outage: the primary model was
 * retired (5028) and 37 days of failures explained themselves nowhere.
 *
 * Fixtures are REAL captures:
 *   - workers-ai-models-index.md  : developers.cloudflare.com/workers-ai/models/index.md
 *   - the 5028 text               : returned by Workers AI on 2026-09-24
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseModelsIndex, selectTextCards, rankModels, paramSizeB, discoverTextModels,
  refreshTextModels, getTextModelCascade, runCascade, resetAiModelState,
  MODELS_INDEX_URL, MODELS_KV_KEY, DEFAULT_TEXT_MODELS, RECHECK_MS,
  type FetchText,
} from '../../src/shared/ai-models.js';
import {
  classifyAiError, BadModelOutputError, AllModelsFailedError, PaperFailure,
} from '../../src/shared/ai-errors.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
const INDEX_MD = fixture('workers-ai-models-index.md');
const IDS = (JSON.parse(fixture('workers-ai-model-ids.json')) as { ids: Record<string, string> }).ids;

/** Verbatim from Workers AI, 2026-09-24. */
const REAL_5028 =
  '5028: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30. ' +
  'See the model catalog for alternatives: https://developers.cloudflare.com/workers-ai/models/';

const EXPECTED_PLAIN = [
  'granite-4.0-h-micro', 'llama-3.1-8b-instruct-fp8', 'llama-3.2-1b-instruct',
  'llama-3.2-3b-instruct', 'llama-3.3-70b-instruct-fp8-fast', 'mistral-small-3.1-24b-instruct',
];

// ── helpers ──────────────────────────────────────────────────────────────────

function fakeKV() {
  const store = new Map<string, string>();
  const calls = { get: 0, put: 0 };
  const kv = {
    get: async (k: string) => { calls.get++; return store.get(k) ?? null; },
    put: async (k: string, v: string) => { calls.put++; store.set(k, v); },
  } as unknown as KVNamespace;
  return { kv, store, calls };
}

function makeFetch(o: { index?: string; failPages?: string[]; extraIds?: Record<string, string>; urls?: string[] } = {}): FetchText {
  const ids = { ...IDS, ...(o.extraIds ?? {}) };
  return async (url) => {
    o.urls?.push(url);
    if (url === MODELS_INDEX_URL) return o.index ?? INDEX_MD;
    const m = /\/models\/([^/]+)\/index\.md$/.exec(url);
    if (!m) throw new Error(`unexpected url ${url}`);
    const short = m[1]!;
    if (o.failPages?.includes(short)) throw new Error('HTTP 500');
    const id = ids[short.toLowerCase()];
    if (!id) throw new Error('HTTP 404');
    // a distractor id first: the parser must pick the id matching THIS model
    return `# ${short}\n\nSee also \`@cf/other/some-other-model\`.\n\n\`${id}\`\n\nrun("${id}")`;
  };
}

const NEW_CARD = `
[![Meta logo](https://x/y.svg)<h3>llama-3.9-9b-instruct</h3>

MetaText Generation A brand new plain model. - Cloudflare-hosted](https://developers.cloudflare.com/workers-ai/models/llama-3.9-9b-instruct/)
`;

function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const orig = { info: console.info, warn: console.warn, error: console.error };
  const push = (l: unknown) => {
    try { lines.push(JSON.parse(String(l)) as Record<string, unknown>); } catch { lines.push({ raw: String(l) }); }
  };
  console.info = push; console.warn = push; console.error = push;
  return { lines, restore() { console.info = orig.info; console.warn = orig.warn; console.error = orig.error; } };
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => { resetAiModelState(); logs = captureLogs(); });
afterEach(() => { logs.restore(); });

const events = (name: string) => logs.lines.filter(l => l.event === name);

// ── parsing the real page ────────────────────────────────────────────────────

describe('parseModelsIndex / selectTextCards (real page capture)', () => {
  const cards = parseModelsIndex(INDEX_MD);

  it('parses the model cards from the live markdown', () => {
    assert.ok(cards.length >= 50, `parsed only ${cards.length} cards`);
    const fp8 = cards.find(c => c.name === 'llama-3.1-8b-instruct-fp8');
    assert.equal(fp8?.task, 'Text Generation');
    assert.ok(fp8?.url.endsWith('/llama-3.1-8b-instruct-fp8/'));
  });

  it('reads the trailing badges, so reasoning models can be excluded', () => {
    const glm = cards.find(c => c.name === 'glm-5.3-flash');
    assert.ok(glm?.flags.includes('Reasoning'), `flags: ${JSON.stringify(glm?.flags)}`);
  });

  it('keeps exactly the plain chat models (no reasoning / vision / guard / coder / -lora)', () => {
    const names = selectTextCards(cards).map(c => c.name).sort();
    assert.deepEqual(names, EXPECTED_PLAIN);
  });

  it('keeps llama-3.2-3b-instruct even though the page badges it "LoRA"', () => {
    assert.ok(selectTextCards(cards).some(c => c.name === 'llama-3.2-3b-instruct'));
  });
});

describe('rankModels / paramSizeB', () => {
  it('reads parameter counts from ids', () => {
    assert.equal(paramSizeB('@cf/meta/llama-3.1-8b-instruct-fp8'), 8);
    assert.equal(paramSizeB('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 70);
    assert.equal(paramSizeB('@cf/mistralai/mistral-small-3.1-24b-instruct'), 24);
    assert.equal(paramSizeB('@cf/ibm-granite/granite-4.0-h-micro'), null);
  });

  it('puts the preferred model first, then nearest to 8B, unknown sizes last', () => {
    const ranked = rankModels(EXPECTED_PLAIN.map(n => IDS[n]!));
    assert.deepEqual(ranked, [
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/meta/llama-3.2-1b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/ibm-granite/granite-4.0-h-micro',
    ]);
  });

  it('is deterministic regardless of input order', () => {
    const a = rankModels(EXPECTED_PLAIN.map(n => IDS[n]!));
    const b = rankModels([...EXPECTED_PLAIN].reverse().map(n => IDS[n]!));
    assert.deepEqual(a, b);
  });
});

// ── discovery ────────────────────────────────────────────────────────────────

describe('discoverTextModels', () => {
  it('resolves full ids from each model page (1 index fetch + 1 per plain model)', async () => {
    const urls: string[] = [];
    const found = await discoverTextModels(makeFetch({ urls }));
    assert.equal(found.length, EXPECTED_PLAIN.length);
    assert.equal(found[0], '@cf/meta/llama-3.1-8b-instruct-fp8');
    assert.equal(urls.length, 1 + EXPECTED_PLAIN.length);
  });

  it('survives one model page failing', async () => {
    const found = await discoverTextModels(makeFetch({ failPages: ['llama-3.2-1b-instruct'] }));
    assert.ok(!found.includes('@cf/meta/llama-3.2-1b-instruct'));
    assert.equal(found.length, EXPECTED_PLAIN.length - 1);
    assert.equal(events('ai_models_unresolved').length, 1);
  });

  it('refuses a page whose layout changed (0 cards)', async () => {
    await assert.rejects(
      discoverTextModels(makeFetch({ index: '<html>redesigned, no cards</html>' })),
      /0 cards/,
    );
  });

  it('refuses a result with fewer than 2 usable models', async () => {
    const onlyOne = EXPECTED_PLAIN.filter(n => n !== 'llama-3.1-8b-instruct-fp8');
    await assert.rejects(
      discoverTextModels(makeFetch({ failPages: onlyOne })),
      /only 1 usable model/,
    );
  });
});

// ── compare with stored list, replace if different ───────────────────────────

describe('refreshTextModels', () => {
  it('first run: stores the discovered list', async () => {
    const { kv, store } = fakeKV();
    const out = await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    assert.equal(out.status, 'updated');
    const saved = JSON.parse(store.get(MODELS_KV_KEY)!);
    assert.deepEqual(saved.models, out.models);
    assert.equal(saved.models[0], '@cf/meta/llama-3.1-8b-instruct-fp8');
    assert.equal(events('ai_models_changed').length, 1);
  });

  it('within 24 h: does not even fetch the page', async () => {
    const { kv } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    const urls: string[] = [];
    const out = await refreshTextModels(kv, { fetchText: makeFetch({ urls }), now: () => 1_000_000 + RECHECK_MS - 1 });
    assert.equal(out.status, 'skipped_recent');
    assert.equal(urls.length, 0);
  });

  it('after 24 h with the same page: unchanged, only checked_at moves (1 KV write)', async () => {
    const { kv, store, calls } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    const before = JSON.parse(store.get(MODELS_KV_KEY)!);
    const putsBefore = calls.put;

    const out = await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 + RECHECK_MS + 1 });
    const after = JSON.parse(store.get(MODELS_KV_KEY)!);
    assert.equal(out.status, 'unchanged');
    assert.equal(calls.put, putsBefore + 1);
    assert.deepEqual(after.models, before.models);
    assert.equal(after.changed_at, before.changed_at);
    assert.notEqual(after.checked_at, before.checked_at);
  });

  it('a new model appears on the page: the stored list is REPLACED and the change is logged', async () => {
    const { kv, store } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });

    const out = await refreshTextModels(kv, {
      fetchText: makeFetch({ index: INDEX_MD + NEW_CARD, extraIds: { 'llama-3.9-9b-instruct': '@cf/meta/llama-3.9-9b-instruct' } }),
      now: () => 1_000_000 + RECHECK_MS + 1,
    });
    assert.equal(out.status, 'updated');
    assert.equal(out.models[1], '@cf/meta/llama-3.9-9b-instruct'); // 9B is nearest to 8B after the preferred
    assert.deepEqual(JSON.parse(store.get(MODELS_KV_KEY)!).models, out.models);
    const changed = events('ai_models_changed').at(-1)!;
    assert.deepEqual(changed.added, ['@cf/meta/llama-3.9-9b-instruct']);
  });

  it('a model disappears from the page: it is removed from the stored list', async () => {
    const { kv } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    const out = await refreshTextModels(kv, {
      fetchText: makeFetch({ failPages: ['llama-3.2-3b-instruct'] }),
      now: () => 1_000_000 + RECHECK_MS + 1,
    });
    assert.equal(out.status, 'updated');
    assert.ok(!out.models.includes('@cf/meta/llama-3.2-3b-instruct'));
    assert.deepEqual(events('ai_models_changed').at(-1)!.removed, ['@cf/meta/llama-3.2-3b-instruct']);
  });

  it('page redesign: keeps the working list, writes nothing, logs an ERROR', async () => {
    const { kv, store, calls } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    const good = store.get(MODELS_KV_KEY)!;
    const putsBefore = calls.put;

    const out = await refreshTextModels(kv, {
      fetchText: makeFetch({ index: 'totally different page' }),
      now: () => 1_000_000 + RECHECK_MS + 1,
    });
    assert.equal(out.status, 'failed');
    assert.equal(store.get(MODELS_KV_KEY), good);
    assert.equal(calls.put, putsBefore);
    const err = events('ai_models_refresh_failed').at(-1)!;
    assert.equal(err.level, 'error');
    assert.ok(Array.isArray(err.keeping) && (err.keeping as string[]).length > 0);
  });

  it('network failure on the very first run: falls back to the defaults, writes nothing', async () => {
    const { kv, calls } = fakeKV();
    const out = await refreshTextModels(kv, {
      fetchText: async () => { throw new Error('fetch failed'); },
      now: () => 1_000_000,
    });
    assert.equal(out.status, 'failed');
    assert.deepEqual(out.models, [...DEFAULT_TEXT_MODELS]);
    assert.equal(calls.put, 0);
  });

  it('a failed KV write does not lose the discovered list for this run', async () => {
    const { kv } = fakeKV();
    (kv as unknown as { put: () => Promise<void> }).put = async () => { throw new Error('KV put() limit exceeded for the day.'); };
    const out = await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    assert.equal(out.status, 'updated');
    assert.ok(out.models.length > 0);
    assert.equal(events('ai_models_kv_write_failed').length, 1);
  });
});

// ── classification ───────────────────────────────────────────────────────────

describe('classifyAiError', () => {
  it('recognises the REAL 5028 text as model_deprecated', () => {
    assert.equal(classifyAiError(new Error(REAL_5028)), 'model_deprecated');
  });

  it('recognises the other documented failure shapes (synthetic messages)', () => {
    assert.equal(classifyAiError(new Error('4006: you have used up your daily free allocation of 10,000 neurons')), 'quota_exhausted');
    assert.equal(classifyAiError(new Error('3040: Capacity temporarily exceeded')), 'rate_limited');
    assert.equal(classifyAiError(new Error('HTTP 429 Too Many Requests')), 'rate_limited');
    assert.equal(classifyAiError(new Error('5007: No such model @cf/x/y')), 'model_not_found');
    assert.equal(classifyAiError(new BadModelOutputError('No JSON object found')), 'bad_output');
    assert.equal(classifyAiError(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout');
  });

  it('never hides an unrecognised failure: it is "unknown" and the message survives', async () => {
    assert.equal(classifyAiError(new Error('something brand new')), 'unknown');
    await assert.rejects(
      runCascade('t', ['a'], async () => { throw new Error('something brand new'); }),
      /a → unknown: something brand new/,
    );
  });
});

// ── the cascade ──────────────────────────────────────────────────────────────

describe('runCascade', () => {
  it('a retired model falls through to the next one', async () => {
    const tried: string[] = [];
    const r = await runCascade('summary', ['old', 'new'], async (m) => {
      tried.push(m);
      if (m === 'old') throw new Error(REAL_5028);
      return 'ok';
    });
    assert.equal(r.value, 'ok');
    assert.equal(r.model, 'new');
    assert.deepEqual(tried, ['old', 'new']);
    assert.equal(r.attempts[0]!.code, 'model_deprecated');
    assert.equal(events('ai_cascade_recovered').length, 1);
  });

  it('remembers the retired model: the NEXT call skips it without calling it', async () => {
    const tried: string[] = [];
    const call = async (m: string) => { tried.push(m); if (m === 'old') throw new Error(REAL_5028); return 'ok'; };
    await runCascade('summary', ['old', 'new'], call);
    tried.length = 0;
    const second = await runCascade('summary', ['old', 'new'], call);
    assert.deepEqual(tried, ['new']);
    assert.match(second.attempts[0]!.message, /skipped/);
  });

  it('forgets a dead model after an hour, in case it comes back', async () => {
    let t = 0;
    const tried: string[] = [];
    const call = async (m: string) => { tried.push(m); if (m === 'old') throw new Error(REAL_5028); return 'ok'; };
    await runCascade('s', ['old', 'new'], call, { now: () => t });
    tried.length = 0;
    t = 60 * 60 * 1000 + 1;
    await runCascade('s', ['old', 'new'], call, { now: () => t });
    assert.deepEqual(tried, ['old', 'new']);
  });

  it('bad output moves on to the next model but does NOT mark the model dead', async () => {
    const tried: string[] = [];
    const call = async (m: string) => {
      tried.push(m);
      if (m === 'a') throw new BadModelOutputError('No JSON object found');
      return 'ok';
    };
    await runCascade('s', ['a', 'b'], call);
    await runCascade('s', ['a', 'b'], call);
    assert.deepEqual(tried, ['a', 'b', 'a', 'b']);
  });

  it('account-wide quota exhaustion stops the cascade immediately', async () => {
    const tried: string[] = [];
    await assert.rejects(
      runCascade('s', ['a', 'b', 'c'], async (m) => {
        tried.push(m);
        throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
      }),
      (e: unknown) => e instanceof AllModelsFailedError && e.dominantCode === 'quota_exhausted',
    );
    assert.deepEqual(tried, ['a']);
  });

  it('total failure: the error explains every model, so nobody has to investigate', async () => {
    await assert.rejects(
      runCascade('summary', ['old', 'older'], async () => { throw new Error(REAL_5028); }),
      (e: unknown) => {
        assert.ok(e instanceof AllModelsFailedError);
        assert.equal(e.isInfrastructure, true);
        assert.equal(e.dominantCode, 'model_deprecated');
        assert.match(e.message, /old → model_deprecated: 5028/);
        assert.match(e.message, /older → model_deprecated/);
        return true;
      },
    );
    assert.equal(events('ai_cascade_exhausted').length, 1);
    assert.equal(events('ai_cascade_exhausted')[0]!.level, 'error');
  });

  it('logs the exhausted event once per 5 minutes, not once per paper', async () => {
    let t = 0;
    const fail = async () => { throw new Error(REAL_5028); };
    for (let i = 0; i < 50; i++) await runCascade('summary', ['x'], fail, { now: () => t }).catch(() => {});
    assert.equal(events('ai_cascade_exhausted').length, 1);
    t = 5 * 60 * 1000 + 1;
    await runCascade('summary', ['x'], fail, { now: () => t }).catch(() => {});
    assert.equal(events('ai_cascade_exhausted').length, 2);
  });

  it('an empty model list fails loudly instead of returning nothing', async () => {
    await assert.rejects(runCascade('summary', [], async () => 'x'), /no models available/);
  });
});

// ── which models the cascade uses ────────────────────────────────────────────

describe('getTextModelCascade', () => {
  it('uses the built-in defaults until a list has been stored', async () => {
    const { kv } = fakeKV();
    const r = await getTextModelCascade(kv);
    assert.equal(r.source, 'default');
    assert.deepEqual(r.models, [...DEFAULT_TEXT_MODELS]);
  });

  it('uses the stored list once discovery has run', async () => {
    const { kv } = fakeKV();
    const out = await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    resetAiModelState();
    const r = await getTextModelCascade(kv);
    assert.equal(r.source, 'kv');
    assert.deepEqual(r.models, out.models);
  });

  it('IGNORES a retired SUMMARY_MODEL from config, and says so once', async () => {
    const { kv } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    resetAiModelState();
    const a = await getTextModelCascade(kv, '@cf/meta/llama-3.1-8b-instruct');
    const b = await getTextModelCascade(kv, '@cf/meta/llama-3.1-8b-instruct');
    assert.ok(!a.models.includes('@cf/meta/llama-3.1-8b-instruct'));
    assert.deepEqual(a.models, b.models);
    assert.equal(events('ai_model_configured_unavailable').length, 1);
  });

  it('moves a still-valid SUMMARY_MODEL to the front', async () => {
    const { kv } = fakeKV();
    await refreshTextModels(kv, { fetchText: makeFetch(), now: () => 1_000_000 });
    resetAiModelState();
    const r = await getTextModelCascade(kv, '@cf/meta/llama-3.2-3b-instruct');
    assert.equal(r.models[0], '@cf/meta/llama-3.2-3b-instruct');
  });

  it('reads KV once per 10 minutes, not once per call', async () => {
    const { kv, calls } = fakeKV();
    await getTextModelCascade(kv, undefined, () => 0);
    await getTextModelCascade(kv, undefined, () => 1000);
    await getTextModelCascade(kv, undefined, () => 2000);
    assert.equal(calls.get, 1);
  });
});

// ── per-paper failure reasons ────────────────────────────────────────────────

describe('PaperFailure', () => {
  it('names the stage and the WHY, e.g. summary:model_deprecated', async () => {
    const cause = await runCascade('summary', ['x'], async () => { throw new Error(REAL_5028); }).catch(e => e as Error);
    const f = new PaperFailure('2609.21018', 'summary', cause);
    assert.equal(f.reasonKey, 'summary:model_deprecated');
    assert.match(f.message, /Summary failed for 2609\.21018: .*model_deprecated: 5028/);
  });

  it('separates a D1 quota failure from an AI failure', () => {
    const f = new PaperFailure('1', 'db_write', new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."));
    assert.equal(f.reasonKey, 'db_write:d1_quota');
  });

  it('classifies an embedding failure by its message', () => {
    assert.equal(new PaperFailure('1', 'embedding', new Error(REAL_5028)).reasonKey, 'embedding:model_deprecated');
  });
});
