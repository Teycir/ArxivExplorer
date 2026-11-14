import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getPapersByAuthor } from '../../src/shared/db.js';

type Captured = { sql: string; binds: unknown[] };

function captureDB(captured: Captured[]): D1Database {
  const stmt = (sql: string, binds: unknown[] = []): Record<string, unknown> => ({
    bind: (...next: unknown[]) => stmt(sql, next),
    all: async () => {
      captured.push({ sql, binds });
      return { results: [], success: true, meta: { rows_read: 0, rows_written: 0 } };
    },
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

describe('getPapersByAuthor', () => {
  it('searches the FTS index instead of scanning papers with LIKE', async () => {
    const captured: Captured[] = [];
    await getPapersByAuthor(captureDB(captured), 'Yuanhe Zhang', 50);

    assert.equal(captured.length, 1);
    const { sql, binds } = captured[0]!;
    assert.match(sql, /papers_fts MATCH \?/);
    assert.doesNotMatch(sql, /LIKE/);
    assert.equal(binds[0], '"Yuanhe Zhang"');
  });

  it('escapes embedded quotes so a name cannot break the phrase', async () => {
    const captured: Captured[] = [];
    await getPapersByAuthor(captureDB(captured), 'Ann "A" Smith', 10);

    assert.equal(captured[0]!.binds[0], '"Ann ""A"" Smith"');
  });
});
