/**
 * tests/unit/db-budget.test.ts
 *
 * Guards for the two things that made the Sept 2026 outage invisible:
 *   1. over-budget row reads were never measured, so the account ran at 2.3× the
 *      free-tier limit for weeks without anyone noticing;
 *   2. when the quota finally ran out, pages returned HTTP 200 + an empty state,
 *      so neither users nor monitoring could tell "no data" from "database off".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  withRowBudget,
  isD1QuotaError,
  secondsUntilQuotaReset,
  REQUEST_ROW_BUDGET,
} from '../../src/shared/db-budget.js';
import { dbErrorResponse } from '../../src/shared/utils.js';

const CORS = { 'Access-Control-Allow-Origin': 'https://example.com' };

const REAL_QUOTA_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. " +
  'Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.';

/** Minimal D1 stand-in whose every statement reports `rowsRead` rows read. */
function makeFakeDB(rowsRead: number): D1Database {
  const meta = { rows_read: rowsRead, rows_written: 0 };
  const makeStmt = (): Record<string, unknown> => {
    const stmt: Record<string, unknown> = {
      bind: () => makeStmt(),
      all: async () => ({ results: [], success: true, meta }),
      run: async () => ({ results: [], success: true, meta }),
      raw: async () => [],
      first: async () => null, // .first() reports no meta in the Workers binding
    };
    return stmt;
  };
  return {
    prepare: () => makeStmt(),
    batch: async (stmts: unknown[]) => stmts.map(() => ({ results: [], success: true, meta })),
    exec: async () => ({}),
    dump: async () => ({}),
    withSession: () => ({}),
  } as unknown as D1Database;
}

describe('withRowBudget', () => {
  it('warns exactly once when a request exceeds the row budget', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

    try {
      const db = withRowBudget(makeFakeDB(3000), '/api/topics', REQUEST_ROW_BUDGET);

      await (await db.prepare('SELECT 1').bind()).all();
      assert.equal(warnings.length, 0, 'under budget must not warn');

      await db.prepare('SELECT 1').all();
      assert.equal(warnings.length, 1, 'crossing the budget must warn');
      assert.match(warnings[0]!, /\[db-budget\]/);
      assert.match(warnings[0]!, /\/api\/topics/);

      await db.prepare('SELECT 1').all();
      assert.equal(warnings.length, 1, 'must warn once per request, not per query');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('sums rows reported by db.batch()', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

    try {
      const db = withRowBudget(makeFakeDB(2600), '/admin/backfill', REQUEST_ROW_BUDGET);
      const stmts = [db.prepare('A'), db.prepare('B'), db.prepare('C')];
      await db.batch(stmts);
      assert.equal(warnings.length, 1, '3 × 2600 = 7800 rows must trip the 5,000-row budget');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('does not count .first(), which reports no metadata in the binding', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };

    try {
      const db = withRowBudget(makeFakeDB(999_999), '/api/first', REQUEST_ROW_BUDGET);
      await db.prepare('SELECT 1').first();
      assert.equal(warnings.length, 0);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('isD1QuotaError', () => {
  it('recognises the row-read limit message returned in production', () => {
    assert.equal(isD1QuotaError(REAL_QUOTA_MESSAGE), true);
    assert.equal(isD1QuotaError(new Error(REAL_QUOTA_MESSAGE)), true);
  });

  it('recognises the row-write limit too', () => {
    assert.equal(
      isD1QuotaError("D1_ERROR: Your account has exceeded D1's free tier daily row write limit."),
      true
    );
  });

  it('does not treat ordinary query errors as a quota error', () => {
    assert.equal(isD1QuotaError(new Error('no such column: scale')), false);
    assert.equal(isD1QuotaError('KV put() limit exceeded for the day.'), false);
  });
});

describe('secondsUntilQuotaReset', () => {
  it('resets at 00:00 UTC', () => {
    assert.equal(secondsUntilQuotaReset(new Date('2026-09-23T12:00:00Z')), 43_200);
    assert.equal(secondsUntilQuotaReset(new Date('2026-09-23T23:59:00Z')), 60);
  });

  it('never returns less than 60s (stops Retry-After flapping)', () => {
    assert.equal(secondsUntilQuotaReset(new Date('2026-09-23T23:59:59Z')), 60);
  });
});

describe('dbErrorResponse', () => {
  it('answers a quota rejection with 503 + Retry-After + degraded', () => {
    const res = dbErrorResponse(new Error(REAL_QUOTA_MESSAGE), CORS, 'topics');
    assert.equal(res.status, 503);

    const retryAfter = Number(res.headers.get('Retry-After'));
    assert.ok(retryAfter >= 60 && retryAfter <= 86_400,
      `Retry-After must be seconds until the 00:00 UTC reset, got ${retryAfter}`);

    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.match(res.headers.get('Content-Type') ?? '', /application\/json/);

    return res.json().then((body: unknown) => {
      const parsed = body as { degraded?: boolean; retryAfter?: number };
      assert.equal(parsed.degraded, true,
        'the degraded flag is what lets clients tell "no data" from "database off"');
      assert.equal(parsed.retryAfter, retryAfter);
    });
  });

  it('keeps the previous 500 for real query errors', () => {
    const res = dbErrorResponse(new Error('no such column: scale'), CORS, 'topics');
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('Retry-After'), null);
  });
});
