#!/usr/bin/env tsx
/**
 * scripts/local-backfill-post-ingest.ts
 *
 * Fixes gaps left after bulk-ingest.ts runs locally:
 *   1. authors_normalized  — missing for some papers
 *   2. related_papers      — missing for some papers (TF-IDF, local)
 *   3. Retry summary_ready=2 papers via Ollama
 *   4. embeddings          — missing for summary_ready=1 papers (nomic-embed-text, concurrent)
 *
 * Safe to run multiple times — skips already-complete rows.
 */

import Database from 'better-sqlite3';
import { buildTf, buildIdf, findSimilar, type CorpusEntry, type TfMap } from '../src/ingest-worker/tfidf';

const LOCAL_DB   = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite';
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const SUMMARY_MODEL = process.env.OLLAMA_SUMMARY_MODEL || 'gemma4:e4b';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const CORPUS_SIZE = 800;
const TOP_K = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAuthors(authorsJson: string): string {
  try {
    const arr: string[] = JSON.parse(authorsJson);
    return arr
      .map(name => name.toLowerCase().replace(/[^a-z\s]/g, '').trim())
      .join(' | ');
  } catch {
    return authorsJson.toLowerCase();
  }
}

// ── 1. authors_normalized ────────────────────────────────────────────────────

function backfillAuthorsNormalized(db: Database.Database): void {
  const rows = db.prepare(
    `SELECT id, authors FROM papers
     WHERE (authors_normalized IS NULL OR authors_normalized = '')
     AND summary_ready = 1`
  ).all() as { id: string; authors: string }[];

  if (rows.length === 0) {
    console.log('✅ authors_normalized: already complete');
    return;
  }

  console.log(`\n📝 authors_normalized: backfilling ${rows.length} papers...`);
  const stmt = db.prepare(`UPDATE papers SET authors_normalized = ? WHERE id = ?`);
  const update = db.transaction((batch: { id: string; authors: string }[]) => {
    for (const { id, authors } of batch) {
      stmt.run(normalizeAuthors(authors), id);
    }
  });

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    update(rows.slice(i, i + CHUNK));
    process.stdout.write(`\r  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  console.log(`\n✅ authors_normalized: done`);
}

// ── 2. related_papers (TF-IDF local) ────────────────────────────────────────

async function backfillRelated(db: Database.Database): Promise<void> {
  const missing = db.prepare(`
    SELECT p.id, p.title, p.abstract
    FROM papers p
    LEFT JOIN related_papers r ON p.id = r.paper_id
    WHERE p.summary_ready = 1 AND r.paper_id IS NULL
    ORDER BY p.indexed_at DESC
  `).all() as { id: string; title: string; abstract: string }[];

  if (missing.length === 0) {
    console.log('✅ related_papers: already complete');
    return;
  }

  console.log(`\n🔗 related_papers: computing for ${missing.length} papers...`);

  // Load corpus — most-recent summarised papers
  const corpus = db.prepare(`
    SELECT id, title, abstract FROM papers
    WHERE summary_ready = 1
    ORDER BY indexed_at DESC
    LIMIT ?
  `).all(CORPUS_SIZE) as { id: string; title: string; abstract: string }[];

  // CorpusEntry = { id, tf: TfMap } — title doubled for weighting (same as backfill-related.ts)
  const corpusEntries: CorpusEntry[] = corpus.map(p => ({
    id: p.id,
    tf: buildTf(`${p.title} ${p.title} ${p.abstract}`),
  }));

  const idf = buildIdf(corpusEntries.map(c => c.tf));

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO related_papers (paper_id, related_paper_id, similarity_score, rank, computed_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const now = new Date().toISOString();
  let done = 0;

  const insertBatch = db.transaction((paperId: string, similars: Array<{ id: string; score: number }>) => {
    similars.forEach(({ id, score }, idx) => {
      insertStmt.run(paperId, id, score, idx + 1, now);
    });
  });

  for (const paper of missing) {
    const queryTf = buildTf(`${paper.title} ${paper.title} ${paper.abstract}`);
    const similars = findSimilar(paper.id, queryTf, corpusEntries, TOP_K);
    insertBatch(paper.id, similars);
    done++;
    if (done % 100 === 0 || done === missing.length) {
      process.stdout.write(`\r  ${done}/${missing.length}`);
    }
  }
  console.log(`\n✅ related_papers: done (${done} papers covered)`);
}

// ── 3. Retry failed papers ───────────────────────────────────────────────────

interface SummaryFields {
  tldr: string;
  key_contributions: string[];
  methods: string[];
  limitations: string[];
  beginner_explain: string;
  technical_summary: string;
}

async function generateSummary(title: string, abstract: string): Promise<SummaryFields> {
  const prompt = `You are a research paper summarizer. Return ONLY a valid JSON object.

Paper title: ${title}
Abstract: ${abstract.slice(0, 3500)}

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
      model: SUMMARY_MODEL, prompt, stream: false, format: 'json',
      options: { temperature: 0.2, num_predict: 1024, top_p: 0.9 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json() as { response?: string; error?: string };
  if (data.error) throw new Error(`Ollama: ${data.error}`);
  const raw = data.response?.trim() || '';
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON in response');
  const p = JSON.parse(raw.slice(first, last + 1)) as Partial<SummaryFields>;
  return {
    tldr: String(p.tldr || '').trim() || 'Summary unavailable.',
    key_contributions: Array.isArray(p.key_contributions) ? p.key_contributions.map(String) : [],
    methods: Array.isArray(p.methods) ? p.methods.map(String) : [],
    limitations: Array.isArray(p.limitations) ? p.limitations.map(String) : [],
    beginner_explain: String(p.beginner_explain || '').trim(),
    technical_summary: String(p.technical_summary || '').trim(),
  };
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 2000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
  const data = await res.json() as { embeddings?: number[][]; error?: string };
  if (data.error) throw new Error(data.error);
  const emb = data.embeddings?.[0];
  if (!Array.isArray(emb) || emb.length === 0) throw new Error('Empty embedding');
  return emb;
}

async function retryFailed(db: Database.Database): Promise<void> {
  const failed = db.prepare(
    `SELECT id, title, abstract, authors, categories, published_at, revised_at, pdf_url, html_url
     FROM papers WHERE summary_ready = 2`
  ).all() as any[];

  if (failed.length === 0) {
    console.log('✅ failed papers: none to retry');
    return;
  }

  console.log(`\n🔄 Retrying ${failed.length} failed papers...`);
  const now = new Date().toISOString();

  for (const paper of failed) {
    console.log(`  → ${paper.id}: ${paper.title.slice(0, 60)}`);
    try {
      const [summary, embedding] = await Promise.all([
        generateSummary(paper.title, paper.abstract),
        generateEmbedding(`${paper.title}\n${paper.abstract}`),
      ]);

      db.transaction(() => {
        db.prepare(`UPDATE papers SET summary_ready=1 WHERE id=?`).run(paper.id);
        db.prepare(`INSERT OR REPLACE INTO summaries
          (paper_id, tldr, key_contributions, methods, limitations, beginner_explain, technical_summary, generated_at, model_version)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(paper.id, summary.tldr, JSON.stringify(summary.key_contributions),
               JSON.stringify(summary.methods), JSON.stringify(summary.limitations),
               summary.beginner_explain, summary.technical_summary, now, SUMMARY_MODEL);
        db.prepare(`INSERT OR REPLACE INTO embeddings (paper_id, embedding) VALUES (?,?)`)
          .run(paper.id, Buffer.from(new Float32Array(embedding).buffer));
        // FTS will be updated by trigger on the UPDATE above
      })();
      console.log(`  ✅ ${paper.id}: ok`);
    } catch (err) {
      console.error(`  ❌ ${paper.id}: ${err}`);
    }
  }
}

// ── 4. embeddings backfill ───────────────────────────────────────────────────

const EMBED_CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);

async function backfillEmbeddings(db: Database.Database): Promise<void> {
  const missing = db.prepare(`
    SELECT p.id, p.title, p.abstract
    FROM papers p
    LEFT JOIN embeddings e ON p.id = e.paper_id
    WHERE p.summary_ready = 1 AND e.paper_id IS NULL
    ORDER BY p.indexed_at DESC
  `).all() as { id: string; title: string; abstract: string }[];

  if (missing.length === 0) {
    console.log('✅ embeddings: already complete');
    return;
  }

  console.log(`\n🧬 embeddings: generating for ${missing.length} papers (concurrency=${EMBED_CONCURRENCY})...`);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO embeddings (paper_id, embedding) VALUES (?, ?)`
  );

  let done = 0, failed = 0;
  let idx = 0;
  const total = missing.length;
  const startTime = Date.now();

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= total) break;
      const paper = missing[i]!;
      try {
        const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: EMBEDDING_MODEL, input: `${paper.title}\n${paper.abstract}`.slice(0, 2000) }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { embeddings?: number[][]; error?: string };
        if (data.error) throw new Error(data.error);
        const emb = data.embeddings?.[0];
        if (!Array.isArray(emb) || emb.length === 0) throw new Error('empty embedding');
        insertStmt.run(paper.id, Buffer.from(new Float32Array(emb).buffer));
        done++;
      } catch (err) {
        failed++;
        console.error(`\n  ❌ ${paper.id}: ${err}`);
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = done > 0 ? (done / ((Date.now() - startTime) / 60000)).toFixed(1) : '0';
      process.stdout.write(`\r  ${done + failed}/${total}  ✅ ${done}  ❌ ${failed}  ⏱️  ${elapsed}s  📈 ${rate}/min  `);
    }
  }

  await Promise.all(Array.from({ length: EMBED_CONCURRENCY }, worker));
  console.log(`\n✅ embeddings: done (${done} written, ${failed} failed)`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔧 Post-ingest local backfill');
  console.log(`   DB: ${LOCAL_DB}`);
  console.log(`   Started: ${new Date().toISOString()}\n`);

  const db = new Database(LOCAL_DB);

  // Quick counts before
  const beforeFts     = (db.prepare('SELECT COUNT(*) as c FROM papers_fts').get() as any).c;
  const beforeRel     = (db.prepare('SELECT COUNT(DISTINCT paper_id) as c FROM related_papers').get() as any).c;
  const beforeNorm    = (db.prepare("SELECT COUNT(*) as c FROM papers WHERE (authors_normalized IS NULL OR authors_normalized='') AND summary_ready=1").get() as any).c;
  const beforeFailed  = (db.prepare('SELECT COUNT(*) as c FROM papers WHERE summary_ready=2').get() as any).c;
  const beforeEmb     = (db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as any).c;
  const totalReady    = (db.prepare('SELECT COUNT(*) as c FROM papers WHERE summary_ready=1').get() as any).c;

  console.log(`Before: FTS=${beforeFts} | related=${beforeRel} | norm_missing=${beforeNorm} | failed=${beforeFailed} | embeddings=${beforeEmb}/${totalReady}\n`);

  // 1. authors_normalized (synchronous, fast)
  backfillAuthorsNormalized(db);

  // 2. related_papers (synchronous TF-IDF)
  await backfillRelated(db);

  // 3. Retry failed (async, needs Ollama)
  await retryFailed(db);

  // 4. Missing embeddings (async, concurrent Ollama)
  await backfillEmbeddings(db);

  // Quick counts after
  const afterRel     = (db.prepare('SELECT COUNT(DISTINCT paper_id) as c FROM related_papers').get() as any).c;
  const afterNorm    = (db.prepare("SELECT COUNT(*) as c FROM papers WHERE (authors_normalized IS NULL OR authors_normalized='') AND summary_ready=1").get() as any).c;
  const afterFailed  = (db.prepare('SELECT COUNT(*) as c FROM papers WHERE summary_ready=2').get() as any).c;
  const afterEmb     = (db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as any).c;

  console.log(`\n📊 After:`);
  console.log(`   related_coverage: ${beforeRel} → ${afterRel}`);
  console.log(`   missing_norm    : ${beforeNorm} → ${afterNorm}`);
  console.log(`   failed papers   : ${beforeFailed} → ${afterFailed}`);
  console.log(`   embeddings      : ${beforeEmb} → ${afterEmb} / ${totalReady}`);
  console.log(`\n✅ Done. Next steps:`);
  console.log(`   npm run db:export          # dump SQLite → backup.sql`);
  console.log(`   npm run db:push            # push backup.sql → D1 remote`);
  console.log(`   ADMIN_SECRET=xxx npm run upload-embeddings  # push embeddings → Vectorize`);

  db.close();
}

main().catch(console.error);
