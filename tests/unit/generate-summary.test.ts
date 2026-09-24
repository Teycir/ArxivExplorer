/**
 * tests/unit/generate-summary.test.ts
 *
 * Guards the wiring, not the prompt: generateSummary() must go through
 * ../../src/shared/ai-models.ts's runCascade/getTextModelCascade instead of
 * a hard-coded model list — that hard-coding is exactly what caused every
 * summary to fail for 37 days when the primary model was retired (see
 * src/shared/ai-models.ts's header).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateSummary } from '../../src/ingest-worker/generate-summary.js';
import { resetAiModelState, DEFAULT_TEXT_MODELS } from '../../src/shared/ai-models.js';
import type { Env } from '../../src/shared/types.js';

const VALID_JSON = JSON.stringify({
  tldr: 'A paper about testing.',
  key_contributions: ['contribution one'],
  methods: ['method one'],
  limitations: ['limitation one'],
  beginner_explain: 'Explained simply.',
  technical_summary: 'Explained technically.',
  keywords: ['test'],
  paper_type: 'empirical',
  novelty: 'Something new.',
  applications: ['app one'],
  prerequisites: ['prereq one'],
  follow_up_questions: ['Why?'],
});

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  } as unknown as KVNamespace;
}

/** AI binding whose .run() fails for the given models and succeeds otherwise. */
function fakeAi(opts: { failModels?: string[]; failWith?: () => never } = {}) {
  const calls: string[] = [];
  const run = async (model: string) => {
    calls.push(model);
    if (opts.failModels?.includes(model)) {
      if (opts.failWith) opts.failWith();
      throw new Error(`5028: ${model} was deprecated on 2026-05-30.`);
    }
    return { response: VALID_JSON };
  };
  return { ai: { run } as unknown as Ai, calls };
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: fakeKV(),
    VECTORIZE: {} as VectorizeIndex,
    AI: fakeAi().ai,
    ...overrides,
  } as Env;
}

beforeEach(() => { resetAiModelState(); });

describe('generateSummary — Workers AI cascade wiring', () => {
  it('uses the FIRST default model when it succeeds', async () => {
    const { ai, calls } = fakeAi();
    const env = baseEnv({ AI: ai });

    const result = await generateSummary('some abstract', env);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], DEFAULT_TEXT_MODELS[0]);
    assert.equal(result.tldr, 'A paper about testing.');
  });

  it('falls through to the next model when the primary is retired (5028) — the outage fix', async () => {
    const { ai, calls } = fakeAi({ failModels: [DEFAULT_TEXT_MODELS[0]!] });
    const env = baseEnv({ AI: ai });

    const result = await generateSummary('some abstract', env);

    assert.deepEqual(calls, [DEFAULT_TEXT_MODELS[0], DEFAULT_TEXT_MODELS[1]]);
    assert.equal(result.tldr, 'A paper about testing.');
  });

  it('throws AllModelsFailedError (not a bare Error) when every model is retired', async () => {
    const { ai } = fakeAi({ failModels: [...DEFAULT_TEXT_MODELS] });
    const env = baseEnv({ AI: ai });

    await assert.rejects(
      () => generateSummary('some abstract', env),
      (err: Error) => {
        assert.equal(err.name, 'AllModelsFailedError');
        // Self-explanatory: every model + its reason is in the message itself.
        for (const m of DEFAULT_TEXT_MODELS) assert.ok(err.message.includes(m), err.message);
        assert.ok(err.message.includes('model_deprecated'), err.message);
        return true;
      },
    );
  });

  it('ignores a stale SUMMARY_MODEL that is no longer in the current list', async () => {
    const { ai, calls } = fakeAi();
    const env = baseEnv({ AI: ai, SUMMARY_MODEL: '@cf/meta/llama-3.1-8b-instruct' /* pre-fp8, retired */ });

    await generateSummary('some abstract', env);

    // Never calls the stale configured model — the cascade's own defaults are used.
    assert.ok(!calls.includes('@cf/meta/llama-3.1-8b-instruct'));
    assert.equal(calls[0], DEFAULT_TEXT_MODELS[0]);
  });

  it('tries Ollama first, and only falls back to Workers AI when Ollama fails', async () => {
    const { ai, calls } = fakeAi();
    const env = baseEnv({
      AI: ai,
      OLLAMA_BASE: 'http://127.0.0.1:1', // nothing listening — fetch will reject
    });

    const result = await generateSummary('some abstract', env);

    assert.equal(calls.length, 1, 'fell through to Workers AI after Ollama failed');
    assert.equal(result.tldr, 'A paper about testing.');
  });
});

describe('generateSummary — problem_statement is preserved (was silently dropped)', () => {
  // Before this, validateSummaryFields() never returned problem_statement even
  // though the prompt asks for it and pipeline.ts persists it: 0 of 6,686 rows
  // in summaries had it. This pins that it now survives validation.
  function envReturning(payload: Record<string, unknown>): Env {
    const ai = { run: async () => ({ response: JSON.stringify(payload) }) } as unknown as Ai;
    return baseEnv({ AI: ai });
  }
  const base = () => JSON.parse(VALID_JSON) as Record<string, unknown>;

  it('keeps problem_statement when the model provides one', async () => {
    const env = envReturning({ ...base(), problem_statement: 'Existing methods break on long inputs.' });
    const result = await generateSummary('some abstract', env);
    assert.equal(result.problem_statement, 'Existing methods break on long inputs.');
  });

  it('omits the key when absent or blank, so pipeline.ts stores NULL not ""', async () => {
    for (const payload of [base(), { ...base(), problem_statement: '   ' }, { ...base(), problem_statement: 42 }]) {
      const result = await generateSummary('some abstract', envReturning(payload));
      assert.ok(!('problem_statement' in result), JSON.stringify(result));
      assert.equal(result.problem_statement ?? null, null);
    }
  });
});
