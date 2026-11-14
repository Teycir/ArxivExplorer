import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PaperFailure, BadModelOutputError, AllModelsFailedError } from '../../src/shared/ai-errors.js';
import { generateSummary, repairJsonEscapes } from '../../src/ingest-worker/generate-summary.js';
import { selectTextCards } from '../../src/shared/ai-models.js';
import { handlePaperFailure } from '../../src/ingest-worker/retry-queue.js';
import type { Env } from '../../src/shared/types.js';

const QUOTA_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. " +
  'Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.';

describe('failure classification', () => {
  it('labels a D1 quota error as infrastructure even inside the embedding stage', () => {
    // The embeddings_meta INSERT used to be inside the embedding try-block, so
    // this exact shape surfaced as `embedding:unknown`, which spent an attempt.
    const failure = new PaperFailure('2611.16404', 'embedding', new Error(QUOTA_MESSAGE));
    assert.equal(failure.reasonKey, 'embedding:d1_quota');
    assert.equal(failure.isInfrastructure, true);
  });

  it('treats a Vectorize failure as infrastructure, not a bad paper', () => {
    const failure = new PaperFailure('2611.16404', 'vectorize', new Error('Vectorize upsert failed: 500'));
    assert.equal(failure.reasonKey, 'vectorize:vectorize_error');
    assert.equal(failure.isInfrastructure, true);
  });

  it('classifies unusable model output as bad_output instead of unknown', () => {
    const failure = new PaperFailure(
      '2611.16404',
      'summary',
      new BadModelOutputError('Summary field "tldr" is missing or not a non-empty string'),
    );
    assert.equal(failure.reasonKey, 'summary:bad_output');
    assert.equal(failure.isInfrastructure, false);
  });

  it('keeps an unclassified provider error as unknown (no false confidence)', () => {
    const failure = new PaperFailure('2611.16404', 'summary', new Error('AiError: 3043: Internal error'));
    assert.equal(failure.reasonKey, 'summary:unknown');
    assert.equal(failure.isInfrastructure, false);
  });
});

describe('raw error capture', () => {
  it('stores the clipped raw message on the retry record', async () => {
    const written: Array<{ key: string; value: string }> = [];
    const cache = {
      get: async () => null,
      put: async (key: string, value: string) => { written.push({ key, value }); },
      delete: async () => {},
    } as unknown as KVNamespace;

    const outcome = await handlePaperFailure(
      cache,
      '2611.16404',
      new PaperFailure('2611.16404', 'embedding', new Error(QUOTA_MESSAGE)),
    );

    assert.equal(outcome, 'deferred'); // infrastructure → deferred for free
    assert.equal(written.length, 1);
    const record = JSON.parse(written[0]!.value);
    assert.equal(record.reason, 'embedding:d1_quota');
    assert.match(record.message, /exceeded D1's free tier daily row read limit/);
    assert.equal(record.attempts, 0); // no attempt spent
  });
});

/**
 * Runs the real Workers AI path with a stub binding. `OLLAMA_BASE` is absent, so
 * generateSummary goes straight to the model cascade, exactly as in production.
 */
function envWithAI(reply: string): Env {
  return {
    AI: { run: async () => ({ response: reply }) },
  } as unknown as Env;
}

const VALID_SUMMARY = JSON.stringify({
  tldr: 'A one sentence summary.',
  key_contributions: ['Contribution one'],
  methods: ['Method one'],
  limitations: ['Limitation one'],
  beginner_explain: 'Simple explanation.',
  technical_summary: 'Technical description.',
});

describe('generateSummary provider output handling', () => {
  it('accepts a valid JSON answer (control)', async () => {
    const fields = await generateSummary('An abstract.', envWithAI(VALID_SUMMARY));
    assert.equal(fields.tldr, 'A one sentence summary.');
    assert.deepEqual(fields.key_contributions, ['Contribution one']);
  });

  it('marks a chatty, non-JSON answer as bad_output, not unknown', async () => {
    const err = await generateSummary('An abstract.', envWithAI('Sure! Here is the summary you asked for.'))
      .then(() => null, (e: unknown) => e);

    assert.ok(err instanceof AllModelsFailedError, `expected AllModelsFailedError, got ${String(err)}`);
    assert.equal((err as AllModelsFailedError).dominantCode, 'bad_output');
    assert.equal(new PaperFailure('2611.16404', 'summary', err).reasonKey, 'summary:bad_output');
  });

  it('repairs LaTeX backslashes instead of failing the paper (2611.12872)', async () => {
    // Exactly the shape that failed all three cascade models in production:
    // the model echoes \mathcal / \textbf into JSON strings, and a backslash
    // that is not a legal escape makes JSON.parse throw.
    const raw = '{"tldr":"A \\mathcal{X} method","key_contributions":["Uses \\sigma_{i}"],"methods":["m"],"limitations":["l"],"beginner_explain":"b","technical_summary":"t"}';
    const fields = await generateSummary('An abstract.', envWithAI(raw));
    assert.equal(fields.tldr, 'A \\mathcal{X} method');
    assert.deepEqual(fields.key_contributions, ['Uses \\sigma_{i}']);
  });

  it('leaves legal JSON escapes untouched', () => {
    const valid = '{"a":"line\\nbreak \\"quoted\\" \\\\ backslash \\u00e9"';
    assert.equal(repairJsonEscapes(valid), valid);
  });

  it('excludes the licence-gated vision model from the cascade', () => {
    const kept = selectTextCards([
      { name: 'llama-3.2-11b-vision-instruct', url: '', task: 'Text Generation', flags: [] },
      { name: 'llama-3.1-8b-instruct-fp8', url: '', task: 'Text Generation', flags: [] },
    ]).map(c => c.name);
    assert.deepEqual(kept, ['llama-3.1-8b-instruct-fp8']);
  });

  it('marks JSON missing required fields as bad_output', async () => {
    const err = await generateSummary(
      'An abstract.',
      envWithAI(JSON.stringify({ tldr: '', key_contributions: [], methods: [], limitations: [] })),
    ).then(() => null, (e: unknown) => e);

    assert.ok(err instanceof AllModelsFailedError, `expected AllModelsFailedError, got ${String(err)}`);
    assert.equal((err as AllModelsFailedError).dominantCode, 'bad_output');
    // Every attempt was the model's fault → the paper itself is suspect, so this
    // one is allowed to spend a retry attempt (unlike infrastructure failures).
    assert.equal(new PaperFailure('2611.16404', 'summary', err).isInfrastructure, false);
  });
});
