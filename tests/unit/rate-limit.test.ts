/**
 * tests/unit/rate-limit.test.ts
 *
 * Tests for the KV-backed sliding window rate limiter.
 * Uses an in-memory KV mock — no real Cloudflare bindings needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRateLimit,
  getClientIP,
  withRateLimit,
  INTERNAL_BUCKET,
  type RateLimitConfig,
} from '../../src/api-worker/middleware/rate-limit.js';

// ─── KV mock ─────────────────────────────────────────────────────────────────

function makeKVMock(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (type === 'json') return JSON.parse(raw);
      return raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() { return { keys: [], list_complete: true, cursor: '' }; },
    async getWithMetadata() { return { value: null, metadata: null }; },
  } as unknown as KVNamespace;
}

const BASE_CONFIG: RateLimitConfig = {
  maxRequests: 3,
  windowSeconds: 60,
  lockoutSeconds: 120,
  namespace: 'test',
};

// ─── Basic allow/deny ────────────────────────────────────────────────────────

describe('checkRateLimit — basic allow/deny', () => {
  it('allows first request', async () => {
    const kv = makeKVMock();
    const result = await checkRateLimit(kv, '1.2.3.4', BASE_CONFIG);
    assert.equal(result.allowed, true);
    assert.equal(result.count, 1);
  });

  it('allows up to maxRequests within window', async () => {
    const kv = makeKVMock();
    const ip = '1.2.3.4';
    for (let i = 1; i <= BASE_CONFIG.maxRequests; i++) {
      const result = await checkRateLimit(kv, ip, BASE_CONFIG);
      assert.equal(result.allowed, true, `request ${i} should be allowed`);
    }
  });

  it('denies the request that exceeds maxRequests', async () => {
    const kv = makeKVMock();
    const ip = '5.6.7.8';
    // Exhaust the limit
    for (let i = 0; i < BASE_CONFIG.maxRequests; i++) {
      await checkRateLimit(kv, ip, BASE_CONFIG);
    }
    // This one is over
    const result = await checkRateLimit(kv, ip, BASE_CONFIG);
    assert.equal(result.allowed, false);
  });

  it('includes resetIn when rate-limited', async () => {
    const kv = makeKVMock();
    const ip = '9.10.11.12';
    for (let i = 0; i <= BASE_CONFIG.maxRequests; i++) {
      await checkRateLimit(kv, ip, BASE_CONFIG);
    }
    const result = await checkRateLimit(kv, ip, BASE_CONFIG);
    assert.equal(result.allowed, false);
    assert.ok(typeof result.resetIn === 'number' && result.resetIn > 0,
      'resetIn should be a positive number');
  });
});

// ─── Namespace isolation ──────────────────────────────────────────────────────

describe('checkRateLimit — namespace isolation', () => {
  it('different namespaces are independent counters', async () => {
    const kv = makeKVMock();
    const ip = '1.2.3.4';
    const searchConfig: RateLimitConfig = { ...BASE_CONFIG, maxRequests: 2, namespace: 'search' };
    const claimConfig:  RateLimitConfig = { ...BASE_CONFIG, maxRequests: 2, namespace: 'claim' };

    // exhaust search
    await checkRateLimit(kv, ip, searchConfig);
    await checkRateLimit(kv, ip, searchConfig);
    const searchOverLimit = await checkRateLimit(kv, ip, searchConfig);
    assert.equal(searchOverLimit.allowed, false, 'search should be rate-limited');

    // claim counter is independent — should still have budget
    const claimResult = await checkRateLimit(kv, ip, claimConfig);
    assert.equal(claimResult.allowed, true, 'claim namespace must be independent');
  });

  it('different IPs are independent', async () => {
    const kv = makeKVMock();
    const config: RateLimitConfig = { ...BASE_CONFIG, maxRequests: 1 };

    // exhaust IP A
    await checkRateLimit(kv, '10.0.0.1', config);
    const ipAResult = await checkRateLimit(kv, '10.0.0.1', config);
    assert.equal(ipAResult.allowed, false);

    // IP B is unaffected
    const ipBResult = await checkRateLimit(kv, '10.0.0.2', config);
    assert.equal(ipBResult.allowed, true);
  });
});

// ─── Fail-open on KV error ───────────────────────────────────────────────────

describe('checkRateLimit — fail-open on KV error', () => {
  it('allows request when KV throws', async () => {
    const brokenKV = {
      async get() { throw new Error('KV unavailable'); },
      async put() { throw new Error('KV unavailable'); },
    } as unknown as KVNamespace;

    const result = await checkRateLimit(brokenKV, '1.2.3.4', BASE_CONFIG);
    assert.equal(result.allowed, true,
      'rate limiter must fail-open — never block traffic on KV infrastructure failure');
  });
});

// ─── getClientIP ─────────────────────────────────────────────────────────────
//
// These assertions were changed on 2026-09-23 while fixing the D1 quota outage.
// The old expectations encoded the vulnerability: `x-real-ip` was trusted
// because "our Next.js proxy sends it", but this worker is publicly reachable
// (workers_dev = true), so any caller could set that header and mint a fresh
// rate-limit bucket per request. Requests with no CF header also used to collapse
// every SSR render worldwide into one shared `'0.0.0.0'` bucket.

describe('getClientIP', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('https://example.com/', { headers });
  }

  it('prefers cf-connecting-ip (edge-set, not client-settable)', () => {
    const req = makeRequest({
      'x-real-ip': '192.168.1.1',
      'cf-connecting-ip': '10.0.0.1',
    });
    assert.equal(getClientIP(req), '10.0.0.1');
  });

  it('ignores x-real-ip when no internal token is configured', () => {
    const req = makeRequest({ 'x-real-ip': '192.168.1.1' });
    assert.equal(getClientIP(req), INTERNAL_BUCKET,
      'an unauthenticated forwarded IP must never be trusted');
  });

  it('ignores x-real-ip when the auth header is missing', () => {
    const req = makeRequest({ 'x-real-ip': '192.168.1.1' });
    assert.equal(getClientIP(req, 'secret-token'), INTERNAL_BUCKET);
  });

  it('ignores x-real-ip when the auth header is wrong', () => {
    const req = makeRequest({
      'x-real-ip': '192.168.1.1',
      'x-internal-auth': 'wrong-secret',
    });
    assert.equal(getClientIP(req, 'secret-token'), INTERNAL_BUCKET);
  });

  it('honours x-real-ip only with a matching shared secret', () => {
    const req = makeRequest({
      'x-real-ip': '192.168.1.1',
      'x-internal-auth': 'secret-token',
    });
    assert.equal(getClientIP(req, 'secret-token'), '192.168.1.1');
  });

  it('still prefers cf-connecting-ip over a valid forwarded IP', () => {
    const req = makeRequest({
      'x-real-ip': '192.168.1.1',
      'x-internal-auth': 'secret-token',
      'cf-connecting-ip': '10.0.0.1',
    });
    assert.equal(getClientIP(req, 'secret-token'), '10.0.0.1');
  });

  it('buckets internal service-binding traffic under INTERNAL_BUCKET, not 0.0.0.0', () => {
    const req = makeRequest({});
    assert.equal(getClientIP(req), INTERNAL_BUCKET);
    assert.equal(getClientIP(req, 'secret-token'), INTERNAL_BUCKET);
  });
});

// ─── withRateLimit ───────────────────────────────────────────────────────────

/** KV mock that records how many writes happen — the budget under scrutiny. */
function countingKVMock(): { kv: KVNamespace; puts: string[] } {
  const store = new Map<string, string>();
  const puts: string[] = [];
  const kv = {
    async get(key: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      try { return JSON.parse(raw); } catch { return raw; }
    },
    async put(key: string, value: string) {
      puts.push(key);
      store.set(key, value);
    },
    async delete(key: string) { store.delete(key); },
    async list() { return { keys: [], list_complete: true, cursor: '' }; },
    async getWithMetadata() { return { value: null, metadata: null }; },
  } as unknown as KVNamespace;
  return { kv, puts };
}

function publicRequest(): Request {
  return new Request('https://api.example.com/api/topics', {
    headers: { 'cf-connecting-ip': '203.0.113.7' },
  });
}

describe('withRateLimit — native binding only, no KV writes', () => {
  const CORS = { 'Access-Control-Allow-Origin': 'https://example.com' };
  const ok = async (): Promise<Response> => new Response('{"ok":true}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });

  it('never writes to KV when the native limiter approves (the outage regression)', async () => {
    const { kv, puts } = countingKVMock();
    const native = { limit: async (_o: { key: string }) => ({ success: true }) };

    for (let i = 0; i < 25; i++) {
      const res = await withRateLimit(
        publicRequest(), kv,
        { maxRequests: 60, windowSeconds: 60, namespace: 'topics' },
        CORS, ok, native
      );
      assert.equal(res.status, 200);
    }

    assert.equal(puts.length, 0,
      'the native limiter must not cost any KV write — 1 KV write/request burned '
      + 'the 1,000 writes/day free-tier budget and silently disabled the response '
      + 'cache, which is what caused the Sept 2026 D1 quota outage');
  });

  it('returns 429 when the native limiter denies, without touching KV', async () => {
    const { kv, puts } = countingKVMock();
    const native = { limit: async (_o: { key: string }) => ({ success: false }) };

    const res = await withRateLimit(
      publicRequest(), kv,
      { maxRequests: 60, windowSeconds: 60, namespace: 'topics' },
      CORS, ok, native
    );

    assert.equal(res.status, 429);
    assert.equal(puts.length, 0);
    assert.equal(res.headers.get('Retry-After'), '60');
  });

  it('keys the native limiter per route so namespaces stay independent', async () => {
    const seen: string[] = [];
    const native = { limit: async (o: { key: string }) => { seen.push(o.key); return { success: true }; } };

    await withRateLimit(publicRequest(), countingKVMock().kv,
      { maxRequests: 60, windowSeconds: 60, namespace: 'topics' }, CORS, ok, native);
    await withRateLimit(publicRequest(), countingKVMock().kv,
      { maxRequests: 60, windowSeconds: 60, namespace: 'stats' }, CORS, ok, native);

    assert.deepEqual(seen, ['topics:203.0.113.7', 'stats:203.0.113.7']);
  });

  it('routes internal traffic to the handler without the native limiter or KV writes', async () => {
    const { kv, puts } = countingKVMock();
    let nativeCalls = 0;
    const native = { limit: async (_o: { key: string }) => { nativeCalls++; return { success: false }; } };

    const res = await withRateLimit(
      new Request('https://api-internal/api/topics'), // no client IP headers
      kv,
      { maxRequests: 60, windowSeconds: 60, namespace: 'topics' },
      CORS, ok, native
    );

    assert.equal(res.status, 200,
      'our own worker renders pages for many users — it must not be throttled by a shared bucket');
    assert.equal(nativeCalls, 0);
    assert.equal(puts.length, 0);
  });

  it('falls back to the KV limiter when no native binding is configured', async () => {
    const { kv, puts } = countingKVMock();
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60, namespace: 'x' };

    const first = await withRateLimit(publicRequest(), kv, config, CORS, ok);
    const second = await withRateLimit(publicRequest(), kv, config, CORS, ok);
    const third = await withRateLimit(publicRequest(), kv, config, CORS, ok);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.ok(puts.length > 0, 'KV path should record its counter writes');
  });
});

