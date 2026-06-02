#!/usr/bin/env tsx
/**
 * scripts/backfill-summaries-v2.ts
 * Re-generates summaries for papers whose summary row is missing the extended
 * fields added in Phase 2 (keywords, paper_type, novelty, applications,
 * prerequisites, follow_up_questions).
 *
 * A summary is considered "v1" (needs backfill) when:
 *   • summary row exists (summary_ready = 1), AND
 *   • s.paper_type IS NULL OR s.paper_type = ''
 *
 * The script calls the Ollama API directly (same model + prompt as the
 * ingest pipeline) and writes the extended fields into the summaries table.
 *
 * Usage:
 *   npx tsx scripts/backfill-summaries-v2.ts          # remote D1
 *   npx tsx scripts/backfill-summaries-v2.ts --local  # local D1
 *
 * Required env vars (from .env or .env.local):
 *   OLLAMA_BASE           — e.g. http://localhost:11434
 *   OLLAMA_SUMMARY_MODEL  — optional model override (default: gemma4:e4b)
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Load env vars from .env.local / .env (best-effort)
for (const envFile of ['.env.local', '.env']) {
  try {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, '');
    }
  } catch { /* file missing — skip */ }
}

const OLLAMA_BASE  = process.env.OLLAMA_BASE ?? '';
const OLLAMA_MODEL = process.env.OLLAMA_SUMMARY_MODEL ?? 'gemma4:e4b';
const BATCH_SIZE   = 50;
const DELAY_MS     = 500;
const isLocal      = process.argv.includes('--local');
const DB_FLAG      = isLocal ? '--local' : '--remote';

if (!OLLAMA_BASE) {
  console.error('❌ OLLAMA_BASE is not set. Set it in .env.local or .env and retry.');
  process.exit(1);
}

// ─── Wrangler D1 helpers ─────────────────────────────────────────────────────

function d1Query<T>(sql: string): T[] {
  const r = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', DB_FLAG, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const out = r.stdout ?? '';
  const s = out.indexOf('['), e = out.lastIndexOf(']');
  if (s === -1 || e === -1) throw new Error(`No JSON:\n${out.slice(0, 400)}\n${r.stderr?.slice(0, 200)}`);
  const parsed = JSON.parse(out.slice(s, e + 1)) as Array<{ results: T[]; success: boolean }>;
  if (!parsed[0]?.success) throw new Error('D1 query failed');
  return parsed[0].results;
}

function d1ExecFile(sql: string): void {
  const tmp = path.join(os.tmpdir(), `backfill-sv2-${Date.now()}.sql`);
  try {
    fs.writeFileSync(tmp, sql, 'utf8');
    const r = spawnSync(
      'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', DB_FLAG, '--file', tmp],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc   = (s: string)  => s.replace(/'/g, "''");

// ─── Ollama call ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a research paper summarizer. ' +
  'Return ONLY a valid JSON object with no preamble, explanation, or markdown fences.';

const USER_PROMPT = `Summarize this research paper abstract. Return ONLY valid JSON, no other text.

Abstract:
{abstract}

JSON format:
{
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "paper_type": "empirical",
  "novelty": "One sentence describing what is novel compared to prior work",
  "applications": ["application 1", "application 2"],
  "prerequisites": ["concept 1", "concept 2"],
  "follow_up_questions": ["Question 1?", "Question 2?"]
}

paper_type must be one of: empirical, theoretical, survey, dataset, position, tutorial, unknown.`;

interface ExtendedFields {
  keywords: string[];
  paper_type: string;
  novelty: string;
  applications: string[];
  prerequisites: string[];
  follow_up_questions: string[];
}

async function generateExtendedFields(abstract: string): Promise<ExtendedFields> {
  const prompt = USER_PROMPT.replace('{abstract}', abstract.slice(0, 4000));

  const res = await fetch(`${OLLAMA_BASE.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: `${SYSTEM_PROMPT}\n\n${prompt}`,
      stream: false,
      format: 'json',
      options: { temperature: 0.3, num_predict: 512 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

  const data = await res.json() as { response?: string; error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  if (!data.response?.trim()) throw new Error('Ollama returned empty response');

  let cleaned = data.response.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON object in Ollama response');
  const parsed = JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;

  const VALID_TYPES = new Set(['empirical','theoretical','survey','dataset','position','tutorial','unknown']);
  const softStr = (k: string, fb = '') => (typeof parsed[k] === 'string' && (parsed[k] as string).trim()) ? (parsed[k] as string).trim() : fb;
  const softArr = (k: string) => (Array.isArray(parsed[k]) ? (parsed[k] as unknown[]).filter(x => typeof x === 'string').map(x => (x as string).trim()) : []);

  const paper_type = softStr('paper_type', 'unknown');
  return {
    keywords: softArr('keywords'),
    paper_type: VALID_TYPES.has(paper_type) ? paper_type : 'unknown',
    novelty: softStr('novelty'),
    applications: softArr('applications'),
    prerequisites: softArr('prerequisites'),
    follow_up_questions: softArr('follow_up_questions'),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🤖 Summaries v2 backfill — ${isLocal ? 'local' : 'remote'} D1`);
  console.log(`   Ollama: ${OLLAMA_BASE}  model: ${OLLAMA_MODEL}`);

  const rows = d1Query<{ id: string; abstract: string }>(
    `SELECT p.id, p.abstract
     FROM papers p
     JOIN summaries s ON s.paper_id = p.id
     WHERE p.summary_ready = 1
       AND (s.paper_type IS NULL OR s.paper_type = '' OR s.paper_type = 'unknown')
     ORDER BY p.indexed_at DESC`
  );
  console.log(`   ${rows.length} summaries need extended fields\n`);
  if (!rows.length) { console.log('✅ Nothing to do.'); return; }

  let ok = 0, failed = 0;
  const batch: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const { id, abstract } = rows[i]!;
    try {
      const fields = await generateExtendedFields(abstract);
      await delay(DELAY_MS);

      batch.push(
        `UPDATE summaries SET ` +
        `keywords='${esc(JSON.stringify(fields.keywords))}', ` +
        `paper_type='${esc(fields.paper_type)}', ` +
        `novelty='${esc(fields.novelty)}', ` +
        `applications='${esc(JSON.stringify(fields.applications))}', ` +
        `prerequisites='${esc(JSON.stringify(fields.prerequisites))}', ` +
        `follow_up_questions='${esc(JSON.stringify(fields.follow_up_questions))}' ` +
        `WHERE paper_id='${esc(id)}';`
      );
      ok++;
    } catch (err) { console.error(`\n   ❌ ${id}: ${err}`); failed++; }

    if (batch.length >= BATCH_SIZE) { d1ExecFile(batch.join('\n')); batch.length = 0; }
    process.stdout.write(`\r   ${i + 1}/${rows.length}  ok:${ok}  fail:${failed}  `);
  }

  if (batch.length) d1ExecFile(batch.join('\n'));
  console.log(`\n\n✅ Done — updated:${ok}  failed:${failed}`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
