import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPush, parseArgs, validStats, PROD_DB_NAME,
  type DbStats, type PushOptions,
} from './push-guards.ts';

const ID = '67fa825b-9f3e-478c-99d2-3e5cc1b0f3de';
const stats = (o: Partial<DbStats> = {}): DbStats => ({
  papers: 17011, summaries: 6686, relatedPapers: 75679, embeddingsMeta: 8826, topics: 25, ready: 17011, ...o,
});
const goodOpts: PushOptions = { yes: true, allowShrink: false, dryRun: false, confirmName: PROD_DB_NAME };
const run = (l: DbStats, r: DbStats | null, o: Partial<PushOptions> = {}, cfg = ID) =>
  checkPush(l, r, { ...goodOpts, ...o }, cfg, ID);

test('same size, everything ready, all consent given -> allowed', () => {
  const res = run(stats(), stats());
  assert.equal(res.ok, true, res.errors.join('; '));
});

test('local bigger than production -> allowed', () => {
  assert.equal(run(stats({ papers: 20000, ready: 20000 }), stats()).ok, true);
});

test('refuses without --yes', () => {
  const res = run(stats(), stats(), { yes: false });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /--yes/);
});

test('refuses without the typed database name', () => {
  assert.equal(run(stats(), stats(), { confirmName: '' }).ok, false);
  assert.equal(run(stats(), stats(), { confirmName: 'wrong-db' }).ok, false);
});

test('THE incident: local filtered to ready papers only (6681) vs production 17011', () => {
  const res = run(stats({ papers: 6681, ready: 6681 }), stats());
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /papers: local 6681 < production 17011/);
});

test('shrink is refused per table, not just papers', () => {
  const res = run(stats({ relatedPapers: 10 }), stats());
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /related_papers/);
});

test('--allow-shrink downgrades the shrink error to a warning', () => {
  const res = run(stats({ papers: 6681, ready: 6681 }), stats(), { allowShrink: true });
  assert.equal(res.ok, true);
  assert.match(res.warnings.join(' '), /less than half/);
});

test('empty local DB is refused even with --allow-shrink', () => {
  const res = run(stats({ papers: 0, ready: 0 }), stats(), { allowShrink: true });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /0 papers/);
});

test('unreadable production stats -> refuse (fail closed)', () => {
  const res = run(stats(), null);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /could not read production/);
});

test('NaN / negative / fractional remote stats are treated as unreadable', () => {
  assert.equal(validStats(stats({ papers: NaN })), false);
  assert.equal(validStats(stats({ papers: -1 })), false);
  assert.equal(validStats(stats({ papers: 1.5 })), false);
  assert.equal(run(stats(), stats({ papers: NaN })).ok, false);
});

test('CF_D1_ID differing from wrangler database_id is refused', () => {
  assert.equal(run(stats(), stats(), {}, 'some-other-db-id').ok, false);
  assert.equal(run(stats(), stats(), {}, '').ok, false);
});

test('papers not summary_ready are still refused (previous guard kept)', () => {
  const res = run(stats({ ready: 6681 }), stats());
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /not summary_ready/);
});

test('invalid local stats are refused', () => {
  assert.equal(run(stats({ papers: NaN }), stats()).ok, false);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs([]), { yes: false, allowShrink: false, dryRun: false, confirmName: '' });
  assert.deepEqual(
    parseArgs(['--yes', '--dry-run', '--allow-shrink', '--confirm-name=arxiv-explorer']),
    { yes: true, allowShrink: true, dryRun: true, confirmName: 'arxiv-explorer' },
  );
  // a bare "yes" or "-y" must NOT count as consent
  assert.equal(parseArgs(['yes']).yes, false);
  assert.equal(parseArgs(['-y']).yes, false);
});
