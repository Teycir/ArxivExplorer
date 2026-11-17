/**
 * tests/unit/inprocess-api.test.ts
 *
 * Guards for the "one Workers request per page view" design.
 *
 * On the Workers Free plan every invocation counts toward the 100,000
 * requests/day wall. Server-rendered pages used to reach the API through the
 * `API` service binding, which is a second invocation per call (the wall was hit
 * on 2026-11-17 with front ~54.7k + api ~45.6k). helper/api.ts now runs the API
 * handlers in-process. That only works while the front worker owns every binding
 * those handlers touch, so these source-scanning assertions fail loudly if
 * someone removes one (a missing RATE_LIMITER would silently push rate limiting
 * onto KV writes, capped at 1,000/day on the free plan).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** wrangler.jsonc allows comments; strip them before JSON.parse. */
function readJsonc(rel: string): Record<string, unknown> {
  const text = read(rel)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('in-process API (one invocation per page view)', () => {
  const api = read('helper/api.ts');

  it('server fetches call the API handler in-process before the service binding', () => {
    const inProcess = api.indexOf('inProcess.fetch(');
    const binding = api.indexOf('apiBinding.fetch(');
    assert.ok(inProcess !== -1, 'helper/api.ts no longer calls the API handler in-process');
    assert.ok(binding !== -1, 'service-binding fallback was removed');
    assert.ok(inProcess < binding, 'in-process call must be tried before the service binding');
  });

  it('still falls back to the public URL if everything else fails', () => {
    assert.match(api, /networkFetch\(`\$\{PUBLIC_API\}\$\{path\}`, init\)/);
  });

  it('the api-worker module still default-exports a fetch handler', () => {
    const worker = read('src/api-worker/index.ts');
    assert.match(worker, /export default\s*\{\s*async fetch\(/);
  });

  it('front worker declares every binding the API handlers need', () => {
    const cfg = readJsonc('wrangler.jsonc') as {
      d1_databases?: Array<{ binding: string }>;
      kv_namespaces?: Array<{ binding: string }>;
      vectorize?: Array<{ binding: string }>;
      ai?: { binding: string };
      ratelimits?: Array<{ name: string }>;
      vars?: Record<string, string>;
    };
    assert.ok(cfg.d1_databases?.some(d => d.binding === 'DB'), 'DB (D1) binding missing');
    assert.ok(cfg.kv_namespaces?.some(k => k.binding === 'CACHE'), 'CACHE (KV) binding missing');
    assert.ok(cfg.vectorize?.some(v => v.binding === 'VECTORIZE'), 'VECTORIZE binding missing');
    assert.equal(cfg.ai?.binding, 'AI', 'AI binding missing');
    assert.ok(
      cfg.ratelimits?.some(r => r.name === 'RATE_LIMITER'),
      'RATE_LIMITER missing: in-process API calls would fall back to KV-backed limiting (1,000 writes/day free)',
    );
    assert.ok(cfg.vars?.ALLOWED_ORIGIN, 'ALLOWED_ORIGIN var missing');
  });
});
