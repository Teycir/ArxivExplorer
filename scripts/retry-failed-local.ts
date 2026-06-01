#!/usr/bin/env tsx
/**
 * scripts/retry-failed-local.ts
 *
 * Pulls summary_ready=0|2 papers from D1 (prod), generates summaries +
 * embeddings locally with Ollama, then pushes results back to D1 + Vectorize.
 *
 * Key design decisions:
 *   - D1 REST API for reads/writes (no wrangler subprocess per paper → 100x faster)
 *   - gemma4:e4b — proper instruction model, JSON in .response (not .thinking)
 *   - /api/embed (new Ollama API, not deprecated /api/embeddings)
 *   - Parameterised SQL — no manual escaping, safe on apostrophes/quotes
 *   - Configurable concurrency (default 1 — Ollama is already GPU-saturated)
 *
 * Usage:
 *   npx tsx scripts/retry-failed-local.ts  (reads from config.local.ts)
 *   LIMIT=20 CONCURRENCY=2 npx tsx scripts/retry-failed-local.ts
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_D1_ID } from './config.local';

const OLLAMA_BASE     = process.env.OLLAMA_BASE            || 'http://localhost:11434';
const SUMMARY_MODEL   = process.env.OLLAMA_SUMMARY_MODEL   || 'gemma4:e4b';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const API_BASE        = process.env.API_BASE               || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET    = process.env.ADMIN_SECRET           || '';
const LIMIT           = parseInt(process.env.LIMIT         || '141', 10);
const CONCURRENCY     = parseInt(process.env.CONCURRENCY   || '1',   10);

// Cloudflare D1 REST API — avoids spawning wrangler subprocess per paper
const D1_API        = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;

// ── D1 REST API helpers ───────────────────────────────────────────────────

interface D1Result { results: Record<string, any>[]; success: boolean; errors?: any[]; meta?: any }

async function d1Query(sql: string, params: (string | number | null)[] = []): Promise<Record<string, any>[]> {
  const res = await fetch(`${D1_API}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) throw new Error(`D1 query HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { result: D1Result[] };
  const r = data.result?.[0];
  if (!r?.success) throw new Error(`D1 query failed: ${JSON.stringify(r?.errors)}`);
  return r.results ?? [];
}

async function d1Run(sql: string, params: (string | number | null)[] = []): Promise<void> {
  const res = await fetch(`${D1_API}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) throw new Error(`D1 run HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { result: D1Result[] };
  const r = data.result?.[0];
  if (!r?.success) throw new Error(`D1 run failed: ${JSON.stringify(r?.errors)}`);
}


// ── Ollama: Summary ───────────────────────────────────────────────────────

interface SummaryFields {
  tldr: string;
  key_contributions: string[];
  methods: string[];
  limitations: string[];
  beginner_explain: string;
  technical_summary: string;
}

async function generateSummary(title: string, abstract: string): Promise<SummaryFields> {
  const prompt = `You are a research paper summarizer. Return ONLY a valid JSON object — no preamble, no markdown fences, no commentary.

Paper title: ${title}

Abstract:
${abstract.slice(0, 3500)}

Respond with exactly this JSON structure:
{
  "tldr": "One clear sentence describing what this paper does and its main result",
  "key_contributions": ["contribution 1", "contribution 2", "contribution 3"],
  "methods": ["method or technique 1", "method 2"],
  "limitations": ["limitation or future work 1"],
  "beginner_explain": "2-3 sentence plain-language explanation for a non-expert",
  "technical_summary": "3-4 sentence technical description for an ML researcher"
}`;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.2, num_predict: 1024, top_p: 0.9 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama generate HTTP ${res.status}`);

  const data = await res.json() as { response?: string; thinking?: string; error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);

  // gemma4:e4b puts output in .response; qwen3 thinking models use .thinking
  const raw = (data.response?.trim() || data.thinking?.trim() || '');
  if (!raw) throw new Error('Ollama returned empty response and empty thinking');

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON object found in response (got: ${raw.slice(0, 120)})`);

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<SummaryFields>;

  // Normalise — ensure all fields exist with sensible defaults
  return {
    tldr:               String(parsed.tldr              || '').trim() || 'Summary unavailable.',
    key_contributions:  Array.isArray(parsed.key_contributions) ? parsed.key_contributions.map(String) : [],
    methods:            Array.isArray(parsed.methods)            ? parsed.methods.map(String)            : [],
    limitations:        Array.isArray(parsed.limitations)        ? parsed.limitations.map(String)        : [],
    beginner_explain:   String(parsed.beginner_explain  || '').trim(),
    technical_summary:  String(parsed.technical_summary || '').trim(),
  };
}


// ── Ollama: Embedding ─────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[]> {
  // /api/embed is the current Ollama API (replaces deprecated /api/embeddings)
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 2000),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
  const data = await res.json() as { embeddings?: number[][]; error?: string };
  if (data.error) throw new Error(`Ollama embed error: ${data.error}`);
  const emb = data.embeddings?.[0];
  if (!Array.isArray(emb) || emb.length === 0) throw new Error('Ollama returned empty embedding');
  return emb;
}

// ── Push: D1 summary + summary_ready flag ────────────────────────────────

async function pushSummaryToD1(paperId: string, s: SummaryFields): Promise<void> {
  const now = new Date().toISOString();

  // Upsert summary row — fully parameterised, safe on any text content
  await d1Run(
    `INSERT OR REPLACE INTO summaries
       (paper_id, tldr, key_contributions, methods, limitations,
        beginner_explain, technical_summary, generated_at, model_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paperId,
      s.tldr,
      JSON.stringify(s.key_contributions),
      JSON.stringify(s.methods),
      JSON.stringify(s.limitations),
      s.beginner_explain,
      s.technical_summary,
      now,
      SUMMARY_MODEL,
    ],
  );

  // Flip summary_ready to 1
  await d1Run(
    `UPDATE papers SET summary_ready = 1 WHERE id = ?`,
    [paperId],
  );
}

// ── Push: Vectorize embedding ─────────────────────────────────────────────

async function pushEmbeddingToVectorize(paper: Record<string, any>, embedding: number[]): Promise<void> {
  let categories: string[] = [];
  try { categories = JSON.parse(paper['categories'] as string); } catch { /* ignore */ }

  const res = await fetch(`${API_BASE}/admin/vectorize/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
    body: JSON.stringify({
      vectors: [{
        id:       `paper-${paper['id']}`,
        values:   embedding,
        metadata: {
          paper_id:     paper['id'],
          published_at: paper['published_at'],
          categories:   categories.join(','),
        },
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new Error('Vectorize upsert 401 — check ADMIN_SECRET');
  if (!res.ok) throw new Error(`Vectorize upsert HTTP ${res.status}`);
}


// ── Concurrency pool ──────────────────────────────────────────────────────

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!, idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ── Process one paper ─────────────────────────────────────────────────────

async function processPaper(
  paper: Record<string, any>,
  label: string,
): Promise<'ok' | 'fail'> {
  const id    = paper['id'] as string;
  const title = paper['title'] as string;
  const abstr = paper['abstract'] as string;

  process.stdout.write(`${label} ${id}  "${title.slice(0, 60)}…"\n`);
  const t0 = Date.now();

  try {
    // Run summary and embedding in parallel — both are local Ollama calls
    const [summary, embedding] = await Promise.all([
      generateSummary(title, abstr),
      generateEmbedding(`${title}\n${abstr}`),
    ]);

    // Write to D1 then Vectorize (order matters — D1 first so API is consistent)
    await pushSummaryToD1(id, summary);
    await pushEmbeddingToVectorize(paper, embedding);

    const ms = Date.now() - t0;
    process.stdout.write(`  ✓ done in ${(ms / 1000).toFixed(1)}s\n`);
    return 'ok';
  } catch (err) {
    process.stdout.write(`  ✗ ${err}\n`);
    // Mark as failed (2) in D1 so it shows up in future retries but doesn't
    // block the count of "still pending" papers
    try {
      await d1Run(`UPDATE papers SET summary_ready = 2 WHERE id = ?`, [id]);
    } catch { /* best-effort */ }
    return 'fail';
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 ArxivExplorer — Local Ollama Retry');
  console.log(`   Summary model : ${SUMMARY_MODEL}`);
  console.log(`   Embed model   : ${EMBEDDING_MODEL}`);
  console.log(`   Ollama        : ${OLLAMA_BASE}`);
  console.log(`   Limit         : ${LIMIT}  Concurrency: ${CONCURRENCY}\n`);

  if (!ADMIN_SECRET) {
    console.error('❌ ADMIN_SECRET env var is required (needed to push to Vectorize)');
    process.exit(1);
  }

  // Verify Ollama is reachable
  try {
    const ping = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
    console.log('✅ Ollama reachable');
  } catch (err) {
    console.error(`❌ Ollama not reachable at ${OLLAMA_BASE}: ${err}`);
    process.exit(1);
  }

  // Verify D1 REST API token
  try {
    const test = await d1Query(`SELECT COUNT(*) as n FROM papers WHERE summary_ready IN (0,2)`);
    const pending = test[0]?.['n'] ?? '?';
    console.log(`✅ D1 reachable — ${pending} papers pending/failed in prod\n`);
  } catch (err) {
    console.error(`❌ D1 REST API error: ${err}`);
    process.exit(1);
  }

  // Fetch all pending/failed papers (status 0 first, then 2)
  console.log(`Fetching up to ${LIMIT} papers from D1…`);
  const papers = await d1Query(
    `SELECT id, title, abstract, categories, published_at
     FROM papers
     WHERE summary_ready IN (0, 2)
     ORDER BY summary_ready ASC, indexed_at ASC
     LIMIT ?`,
    [LIMIT],
  );

  if (papers.length === 0) {
    console.log('🎉 No pending/failed papers — everything is processed!');
    return;
  }
  console.log(`Found ${papers.length} papers to process\n`);

  let done = 0;
  let failed = 0;

  await processWithConcurrency(papers, CONCURRENCY, async (paper, idx) => {
    const label = `[${String(idx + 1).padStart(3)}/${papers.length}]`;
    const result = await processPaper(paper, label);
    if (result === 'ok') done++; else failed++;
  });

  console.log('\n' + '─'.repeat(50));
  console.log(`✅ Finished — ${done} succeeded, ${failed} failed`);

  if (done > 0) {
    console.log('\nNext steps:');
    console.log('  • Trending KV cache auto-refreshes on next API hit (TTL 60min)');
    console.log('  • Paper KV caches repopulate on first fetch per paper');
    console.log('  • Vectorize similarity index rebuilds are eventual (~few min)');
  }
  if (failed > 0) {
    console.log(`\n  Re-run to retry the ${failed} still-failed papers.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
