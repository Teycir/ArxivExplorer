#!/usr/bin/env tsx
/**
 * Bulk CS arXiv ingestion with Ollama — FULLY SEQUENTIAL
 *
 * Flow:
 *   1. Fetch arXiv papers for requested categories / date range
 *   2. Generate summary  → Ollama (local, zero neuron cost)
 *   3. Generate embedding → Ollama (local, zero neuron cost)
 *   4. Write to local SQLite (schema matches D1 production exactly)
 *   5. After all papers: db:export → db:push → ingest:upload-embeddings
 *
 * Usage:
 *   npm run ingest:bulk -- --days 7
 *   npm run ingest:bulk -- --days 30 --categories cs.LG,cs.CL
 */

import { parseStringPromise } from 'xml2js';
import Database from 'better-sqlite3';

const OLLAMA_BASE          = process.env.OLLAMA_BASE          || 'http://localhost:11434';
const SUMMARY_MODEL        = process.env.OLLAMA_SUMMARY_MODEL || 'gemma4:e4b';
const EMBEDDING_MODEL      = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

const CS_CATEGORIES = [
  'cs.AI', 'cs.AR', 'cs.CC', 'cs.CE', 'cs.CG', 'cs.CL', 'cs.CR', 'cs.CV',
  'cs.CY', 'cs.DB', 'cs.DC', 'cs.DL', 'cs.DM', 'cs.DS', 'cs.ET', 'cs.FL',
  'cs.GL', 'cs.GR', 'cs.GT', 'cs.HC', 'cs.IR', 'cs.IT', 'cs.LG', 'cs.LO',
  'cs.MA', 'cs.MM', 'cs.MS', 'cs.NA', 'cs.NE', 'cs.NI', 'cs.OH', 'cs.OS',
  'cs.PF', 'cs.PL', 'cs.RO', 'cs.SC', 'cs.SD', 'cs.SE', 'cs.SI', 'cs.SY'
];

interface Paper {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  published: string;
  updated: string;
  pdfUrl: string;
  htmlUrl?: string;
  comment?: string;
  journalRef?: string;
  doi?: string;
  primaryCategory?: string;
}

async function fetchArxivBatch(category: string, start: number, maxResults: number): Promise<Paper[]> {
  const url = `http://export.arxiv.org/api/query?search_query=cat:${category}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${maxResults}`;
  
  // CONSERVATIVE: Wait 5 seconds before each request to respect arXiv rate limits
  console.log(`Waiting 5s before fetching ${category} (start=${start})...`);
  await new Promise(r => setTimeout(r, 5000));
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    // Handle rate limiting
    if (res.status === 429) {
      console.warn(`Rate limited on ${category}. Waiting 60s...`);
      await new Promise(r => setTimeout(r, 60000));
      return []; // Skip this batch
    }
    
    if (!res.ok) {
      console.warn(`HTTP ${res.status} for ${category}`);
      return [];
    }
    
    const xml = await res.text();
    
    if (!xml || xml.trim().length === 0) {
      console.warn(`Empty response from arXiv for ${category}`);
      return [];
    }
    
    if (!xml.startsWith('<?xml')) {
      console.warn(`Invalid XML response from arXiv for ${category}: ${xml.slice(0, 100)}`);
      return [];
    }
    
    const parsed = await parseStringPromise(xml);
    
    const entries = parsed.feed.entry || [];
    return entries.map((e: any) => ({
      id: e.id[0].split('/abs/')[1],
      title: e.title[0].replace(/\s+/g, ' ').trim(),
      abstract: e.summary[0].replace(/\s+/g, ' ').trim(),
      authors: e.author.map((a: any) => a.name[0]),
      categories: e.category.map((c: any) => c.$.term),
      published: e.published[0].split('T')[0],
      updated: e.updated[0].split('T')[0],
      pdfUrl: `https://arxiv.org/pdf/${e.id[0].split('/abs/')[1]}.pdf`,
      htmlUrl: e.link?.find((l: any) => l.$.type === 'text/html')?.$?.href,
      comment: e['arxiv:comment']?.[0]?._ || e.comment?.[0],
      journalRef: e['arxiv:journal_ref']?.[0]?._ || e.journal_ref?.[0],
      doi: e['arxiv:doi']?.[0]?._ || e.doi?.[0],
      primaryCategory: e['arxiv:primary_category']?.[0]?.$?.term || e.category?.[0]?.$?.term,
    }));
  } catch (err) {
    console.error(`Error fetching ${category}:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function fetchAllCS(daysBack: number): Promise<Paper[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  
  const allPapers: Paper[] = [];
  const seen = new Set<string>();
  
  for (const cat of CS_CATEGORIES) {
    console.log(`Fetching ${cat}...`);
    let start = 0;
    const batchSize = 100;
    
    while (true) {
      const batch = await fetchArxivBatch(cat, start, batchSize);
      if (batch.length === 0) break;
      
      let hitCutoff = false;
      for (const paper of batch) {
        if (new Date(paper.published) < cutoffDate) {
          hitCutoff = true;
          break;
        }
        if (!seen.has(paper.id)) {
          seen.add(paper.id);
          allPapers.push(paper);
        }
      }
      
      if (hitCutoff || batch.length < batchSize) break;
      start += batchSize;
      // REMOVED: No additional delay here, already handled in fetchArxivBatch
    }
  }
  
  return allPapers;
}

async function generateSummary(paper: Paper): Promise<any> {
  const prompt = `You are a research paper summarizer. Return ONLY a valid JSON object with no preamble, explanation, or markdown fences.

Summarize this research paper abstract. Return ONLY valid JSON, no other text.

Abstract:
${paper.abstract.slice(0, 4000)}

JSON format:
{
  "tldr": "One clear sentence describing what this paper does",
  "key_contributions": ["contribution 1", "contribution 2"],
  "methods": ["method 1", "method 2"],
  "limitations": ["limitation 1"],
  "beginner_explain": "Simple explanation in 2-3 sentences",
  "technical_summary": "Technical description in 3-4 sentences"
}`;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.3, num_predict: 1024 },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json() as { response?: string; thinking?: string; error?: string };
  if (data.error) throw new Error(`Ollama: ${data.error}`);
  const raw = (data.response?.trim() || data.thinking?.trim() || '');
  if (!raw) throw new Error('Ollama empty response');

  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON in Ollama response');

  return JSON.parse(cleaned.slice(first, last + 1));
}

async function generateEmbedding(text: string): Promise<number[]> {
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

async function initLocalDB(): Promise<Database.Database> {
  const db = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
  
  // Schema must match D1 production exactly (same columns, no extras).
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      authors TEXT NOT NULL,
      abstract TEXT NOT NULL,
      categories TEXT NOT NULL,
      published_at TEXT NOT NULL,
      revised_at TEXT,
      pdf_url TEXT NOT NULL,
      html_url TEXT,
      indexed_at TEXT NOT NULL,
      summary_ready INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS summaries (
      paper_id TEXT PRIMARY KEY,
      tldr TEXT NOT NULL,
      key_contributions TEXT NOT NULL,
      methods TEXT NOT NULL,
      limitations TEXT NOT NULL,
      beginner_explain TEXT NOT NULL,
      technical_summary TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      model_version TEXT NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    );
    
    -- Local embedding store — NOT synced to D1; uploaded to Vectorize separately.
    CREATE TABLE IF NOT EXISTS embeddings (
      paper_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    );

    CREATE TABLE IF NOT EXISTS paper_categories (
      paper_id TEXT NOT NULL,
      category TEXT NOT NULL,
      PRIMARY KEY (paper_id, category),
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    );
  `);
  
  return db;
}

async function processPaper(db: Database.Database, paper: Paper): Promise<void> {
  const now = new Date().toISOString();
  
  // Check if already fully processed
  const existing = db.prepare('SELECT id, summary_ready FROM papers WHERE id = ?').get(paper.id) as { id: string; summary_ready: number } | undefined;
  if (existing?.summary_ready === 1) {
    console.log(`⊘ ${paper.id}: Already done, skipping`);
    return;
  }
  
  try {
    const summary  = await generateSummary(paper);
    const embedding = await generateEmbedding(`${paper.title} ${paper.abstract}`);
    
    // All writes in a single transaction
    const tx = db.transaction(() => {
      // Paper row — columns match D1 prod exactly
      db.prepare(`
        INSERT OR REPLACE INTO papers
          (id, title, authors, abstract, categories, published_at, revised_at,
           pdf_url, html_url, indexed_at, summary_ready)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        paper.id,
        paper.title,
        JSON.stringify(paper.authors),
        paper.abstract,
        JSON.stringify(paper.categories),
        paper.published,
        paper.updated !== paper.published ? paper.updated : null,
        paper.pdfUrl,
        paper.htmlUrl ?? null,
        now,
      );
      
      // Summary
      db.prepare(`
        INSERT OR REPLACE INTO summaries
          (paper_id, tldr, key_contributions, methods, limitations,
           beginner_explain, technical_summary, generated_at, model_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        paper.id,
        summary.tldr ?? '',
        JSON.stringify(summary.key_contributions ?? []),
        JSON.stringify(summary.methods ?? []),
        JSON.stringify(summary.limitations ?? []),
        summary.beginner_explain ?? '',
        summary.technical_summary ?? '',
        now,
        SUMMARY_MODEL,
      );
      
      // Embedding (local only — uploaded to Vectorize separately)
      const embBuf = Buffer.from(new Float32Array(embedding).buffer);
      db.prepare(`INSERT OR REPLACE INTO embeddings (paper_id, embedding) VALUES (?, ?)`).run(paper.id, embBuf);
      
      // paper_categories junction
      for (const cat of paper.categories) {
        db.prepare(`INSERT OR IGNORE INTO paper_categories (paper_id, category) VALUES (?, ?)`).run(paper.id, cat);
      }
    });
    
    tx();
    console.log(`✓ ${paper.id}: ${paper.title.slice(0, 60)}`);
  } catch (err) {
    console.error(`✗ ${paper.id}: ${err}`);
    // Insert stub so the paper is in D1 as summary_ready=2 (failed, retriable)
    try {
      db.prepare(`
        INSERT OR REPLACE INTO papers
          (id, title, authors, abstract, categories, published_at, revised_at,
           pdf_url, html_url, indexed_at, summary_ready)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
      `).run(
        paper.id,
        paper.title,
        JSON.stringify(paper.authors),
        paper.abstract,
        JSON.stringify(paper.categories),
        paper.published,
        paper.updated !== paper.published ? paper.updated : null,
        paper.pdfUrl,
        paper.htmlUrl ?? null,
        now,
      );
    } catch { /* ignore — paper won't be in DB, ingest-worker will pick it up */ }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const catIdx  = args.indexOf('--categories');
  const daysBack   = daysIdx  !== -1 ? parseInt(args[daysIdx  + 1] || '7') : 7;
  const catArg     = catIdx   !== -1 ? args[catIdx + 1] : undefined;
  const categories = catArg ? catArg.split(',').map(s => s.trim()) : CS_CATEGORIES;

  console.log(`\n🦙 Ollama bulk ingest`);
  console.log(`   Categories : ${categories.join(', ')}`);
  console.log(`   Days back  : ${daysBack}`);
  console.log(`   Summary    : ${SUMMARY_MODEL} @ ${OLLAMA_BASE}`);
  console.log(`   Embedding  : ${EMBEDDING_MODEL} @ ${OLLAMA_BASE}\n`);

  // Verify Ollama is reachable before starting
  try {
    const ping = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
    console.log(`✅ Ollama reachable\n`);
  } catch (err) {
    console.error(`❌ Ollama not reachable at ${OLLAMA_BASE}: ${err}`);
    process.exit(1);
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const db = await initLocalDB();

  // Load all existing paper IDs from local DB to skip already-processed papers
  const existingIds = new Set<string>(
    (db.prepare('SELECT id FROM papers WHERE summary_ready = 1').all() as { id: string }[]).map(r => r.id)
  );
  console.log(`Local DB has ${existingIds.size} already-processed papers — skipping those\n`);

  const allPapers: Paper[] = [];
  const seen = new Set<string>();

  for (const cat of categories) {
    console.log(`Fetching ${cat}...`);
    let start = 0;
    const fetchSize = 50;

    while (true) {
      const batch = await fetchArxivBatch(cat, start, fetchSize);
      if (batch.length === 0) break;

      let hitCutoff = false;
      let allKnown = true;
      for (const paper of batch) {
        if (new Date(paper.published) < cutoffDate) { hitCutoff = true; break; }
        if (!seen.has(paper.id) && !existingIds.has(paper.id)) {
          seen.add(paper.id);
          allPapers.push(paper);
          allKnown = false;
        } else if (!seen.has(paper.id)) {
          seen.add(paper.id); // track seen even if skipping
        }
      }

      // Stop paginating if we hit the date cutoff or every paper in the batch is already in DB
      if (hitCutoff || batch.length < fetchSize || allKnown) break;
      start += fetchSize;
    }
  }

  console.log(`\nFound ${allPapers.length} new papers to process\n`);

  let done = 0, failed = 0;
  for (let i = 0; i < allPapers.length; i++) {
    await processPaper(db, allPapers[i]!);
    const r = (db.prepare('SELECT summary_ready FROM papers WHERE id = ?').get(allPapers[i]!.id) as any)?.summary_ready;
    if (r === 1) done++; else failed++;
    process.stdout.write(`\rProgress: ${i + 1}/${allPapers.length}  ✓${done}  ✗${failed}`);
  }

  db.close();

  console.log(`\n\n✅ Done — ${done} summarised, ${failed} failed`);
  console.log('\nNext steps:');
  console.log('  npm run db:export                # dump SQLite → backup.sql');
  console.log('  npm run db:push                  # push backup.sql → D1 remote');
  console.log('  npm run upload-embeddings        # push embeddings → Vectorize');
}

main().catch(console.error);
