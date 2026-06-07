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

describe('getClientIP', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('https://example.com/', { headers });
  }

  it('prefers x-real-ip over cf-connecting-ip', () => {
    const req = makeRequest({
      'x-real-ip': '192.168.1.1',
      'cf-connecting-ip': '10.0.0.1',
    });
    assert.equal(getClientIP(req), '192.168.1.1');
  });

  it('falls back to cf-connecting-ip when x-real-ip absent', () => {
    const req = makeRequest({ 'cf-connecting-ip': '10.0.0.1' });
    assert.equal(getClientIP(req), '10.0.0.1');
  });

  it('falls back to 0.0.0.0 when both headers absent', () => {
    const req = makeRequest({});
    assert.equal(getClientIP(req), '0.0.0.0');
  });
});
