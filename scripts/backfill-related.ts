#!/usr/bin/env tsx
/**
 * scripts/backfill-related.ts
 * Computes TF-IDF related papers for every summary_ready=1 paper that has
 * no rows in related_papers, writing results via wrangler d1 execute --file.
 *
 * Usage:  npx tsx scripts/backfill-related.ts
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Wrangler D1 helper ──────────────────────────────────────────────────────

function d1Query<T>(sql: string): T[] {
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'arxiv-explorer', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const stdout = r.stdout ?? '';
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error(`No JSON:\n${stdout.slice(0, 400)}\n${r.stderr?.slice(0, 200)}`);
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{ results: T[]; success: boolean }>;
  if (!parsed[0]?.success) throw new Error('D1 query failed');
  return parsed[0].results;
}

function d1Exec(sql: string): void {
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'arxiv-explorer', '--remote', '--command', sql],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
}

/** Write a block of SQL via a temp file — avoids shell arg-length limits for large batches. */
function d1ExecFile(sql: string): void {
  const tmpFile = path.join(os.tmpdir(), `arxiv-backfill-${Date.now()}.sql`);
  try {
    fs.writeFileSync(tmpFile, sql, 'utf8');
    const r = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'arxiv-explorer', '--remote', '--file', tmpFile],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','we','our','they','their',
  'i','my','you','your','he','his','she','her','as','if','not','no',
  'so','such','than','then','when','where','which','who','how','what',
  'all','also','can','into','more','other','there','through','up','about',
  'out','over','after','under','each','same','while','during','based',
  'using','used','use','paper','show','shows','present','propose','proposed',
  'method','methods','approach','work','results','result','both','however',
  'first','second','third','new','two','three','one','well','further',
  'without','between','within','across','per','via','et','al',
]);

type TfMap = Map<string, number>;

function buildTf(text: string): TfMap {
  const tokens = text.toLowerCase().replace(/[-/]/g, ' ').replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/).filter(t => t.length > 2 && !STOP.has(t));
  const tf: TfMap = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const len = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / len);
  return tf;
}

function buildIdf(maps: TfMap[]): Map<string, number> {
  const N = maps.length;
  const df = new Map<string, number>();
  for (const tf of maps) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [t, freq] of df) idf.set(t, Math.log((N + 1) / (freq + 1)) + 1);
  return idf;
}

function vec(tf: TfMap, idf: Map<string, number>): Map<string, number> {
  const v = new Map<string, number>();
  for (const [t, val] of tf) { const i = idf.get(t); if (i) v.set(t, val * i); }
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, nA = 0, nB = 0;
  for (const [t, va] of a) { nA += va * va; const vb = b.get(t); if (vb) dot += va * vb; }
  for (const [, vb] of b) nB += vb * vb;
  return nA && nB ? dot / (Math.sqrt(nA) * Math.sqrt(nB)) : 0;
}

// ─── Fetch helpers (paginated to keep output small) ──────────────────────────

interface PaperRow { id: string; title: string; abstract: string }

function fetchCorpus(): PaperRow[] {
  // Fetch in pages of 500 to keep JSON output under buffer limit
  const out: PaperRow[] = [];
  let offset = 0;
  while (true) {
    const rows = d1Query<PaperRow>(
      `SELECT id, title, substr(abstract, 1, 800) AS abstract
       FROM papers WHERE summary_ready=1
       ORDER BY indexed_at DESC LIMIT 500 OFFSET ${offset}`
    );
    out.push(...rows);
    if (rows.length < 500) break;
    offset += 500;
  }
  return out;
}

function fetchTodo(): string[] {
  const rows = d1Query<{ id: string }>(
    `SELECT p.id FROM papers p
     WHERE p.summary_ready = 1
       AND NOT EXISTS (SELECT 1 FROM related_papers r WHERE r.paper_id = p.id)
     ORDER BY p.indexed_at DESC`
  );
  return rows.map(r => r.id);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

async function main() {
  console.log('📥 Fetching corpus…');
  const corpus = fetchCorpus();
  console.log(`   ${corpus.length} papers in corpus`);
  if (corpus.length < 2) { console.log('Not enough papers.'); return; }

  console.log('🔍 Fetching todo list…');
  const todo = fetchTodo();
  console.log(`   ${todo.length} papers need backfill`);
  if (todo.length === 0) { console.log('✅ Nothing to do.'); return; }

  // Pre-build TF + IDF once
  const corpusTf = corpus.map(r => ({ id: r.id, tf: buildTf(`${r.title} ${r.title} ${r.abstract}`) }));
  const idf = buildIdf(corpusTf.map(c => c.tf));
  const todoSet = new Set(todo);

  let ok = 0, skipped = 0;
  const now = new Date().toISOString();
  const insertLines: string[] = [];

  for (const id of todo) {
    const entry = corpusTf.find(c => c.id === id);
    if (!entry) { skipped++; continue; }

    const qVec = vec(entry.tf, idf);
    const scored: Array<{ id: string; score: number }> = [];
    for (const c of corpusTf) {
      if (c.id === id) continue;
      const score = cosine(qVec, vec(c.tf, idf));
      if (score > 0) scored.push({ id: c.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 8);
    if (top.length === 0) { skipped++; continue; }

    for (let rank = 0; rank < top.length; rank++) {
      const r = top[rank]!;
      const score = +r.score.toFixed(8);
      insertLines.push(
        `INSERT OR REPLACE INTO related_papers (paper_id,related_paper_id,similarity_score,rank,computed_at) VALUES ('${escSql(id)}','${escSql(r.id)}',${score},${rank + 1},'${now}');`
      );
    }
    ok++;
    process.stdout.write(`\r   ${ok + skipped}/${todo.length} computed…`);
  }

  console.log(`\n💾 Writing ${insertLines.length} rows to D1 in batches…`);

  // Flush in batches of 200 INSERT statements per wrangler call
  const BATCH = 200;
  for (let i = 0; i < insertLines.length; i += BATCH) {
    const chunk = insertLines.slice(i, i + BATCH).join('\n');
    d1ExecFile(chunk);
    process.stdout.write(`\r   ${Math.min(i + BATCH, insertLines.length)}/${insertLines.length} rows written…`);
  }

  console.log(`\n\n✅ Done — ${ok} papers backfilled, ${skipped} skipped`);

  // Final count
  const [{ total }] = d1Query<{ total: number }>(
    'SELECT COUNT(DISTINCT paper_id) AS total FROM related_papers'
  );
  console.log(`   related_papers now covers ${total} papers`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
