#!/usr/bin/env tsx
/**
 * scripts/ingest-targeted.ts
 *
 * Time-bounded targeted ingest for under-represented topic categories.
 * Fetches arXiv papers for specified categories, generates summaries +
 * embeddings via Ollama, writes to local SQLite.
 *
 * Hard stops at --max-minutes (default 110 min) so the process always
 * finishes before the 2-hour window, leaving time to push to remote.
 *
 * Usage:
 *   npx tsx scripts/ingest-targeted.ts
 *   npx tsx scripts/ingest-targeted.ts --categories cs.CR,cs.SD --days 60 --max-minutes 110
 */

import { parseStringPromise } from 'xml2js';
import Database from 'better-sqlite3';

const OLLAMA_BASE      = process.env.OLLAMA_BASE            || 'http://localhost:11434';
const SUMMARY_MODEL    = process.env.OLLAMA_SUMMARY_MODEL   || 'gemma4:e4b';
const EMBEDDING_MODEL  = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag: string, def: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] ?? def : def;
};

// Thin-topic arxiv categories (sorted roughly by how thin they are)
const DEFAULT_CATEGORIES = [
  'cs.SD', 'eess.SP', 'eess.AS',   // speech-audio (~391 papers)
  'cs.NI',                           // networking   (~612)
  'cs.CR',                           // cryptography (~752)
  'cs.CC',                           // complexity   (~848)
  'cs.HC',                           // HCI          (~890)
  'cs.IT',                           // info-theory  (~1202)
  'cs.OS',                           // os           (~1211)
  'cs.DC',                           // distributed  (~1275)
  'cs.RO',                           // robotics     (~1289)
].join(',');

const catArg    = get('--categories', DEFAULT_CATEGORIES);
const daysBack  = parseInt(get('--days', '60'));
const maxMin    = parseInt(get('--max-minutes', '110'));
const CATEGORIES = catArg.split(',').map(s => s.trim()).filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────

interface Paper {
  id: string; title: string; abstract: string; authors: string[];
  categories: string[]; published: string; updated: string;
  pdfUrl: string; htmlUrl?: string;
  comment?: string; journalRef?: string; doi?: string; primaryCategory?: string;
}

async function fetchArxivBatch(cat: string, start: number, max: number): Promise<Paper[]> {
  const url = `http://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${max}`;
  await new Promise(r => setTimeout(r, 3000));   // respect rate limit
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
  } catch (err) {
    clearTimeout(t);
    throw new Error(`arXiv fetch failed: ${err}`);
  }
  if (res.status === 429) {
    console.warn(`\n⚠️  Rate limited on ${cat}. Waiting 60s...`);
    await new Promise(r => setTimeout(r, 60000));
    throw new Error(`Rate limited on ${cat}`);
  }
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status} for ${cat}`);
  const xml = await res.text();
  if (!xml.startsWith('<?xml')) throw new Error(`Invalid XML from arXiv`);
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
}

async function generateSummary(paper: Paper): Promise<{
  tldr: string; key_contributions: string[]; methods: string[];
  limitations: string[]; beginner_explain: string; technical_summary: string;
}> {
  const prompt = `You are a research paper summarizer. Return ONLY a valid JSON object — no preamble, no markdown fences, no commentary.

Paper title: ${paper.title}

Abstract:
${paper.abstract.slice(0, 3500)}

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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  if (!raw) throw new Error('Ollama empty response');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON in Ollama response');
  const p = JSON.parse(cleaned.slice(first, last + 1)) as any;
  return {
    tldr:              String(p.tldr || '').trim() || 'Summary unavailable.',
    key_contributions: Array.isArray(p.key_contributions) ? p.key_contributions.map(String) : [],
    methods:           Array.isArray(p.methods)           ? p.methods.map(String)           : [],
    limitations:       Array.isArray(p.limitations)       ? p.limitations.map(String)       : [],
    beginner_explain:  String(p.beginner_explain  || '').trim(),
    technical_summary: String(p.technical_summary || '').trim(),
  };
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 2000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
  const data = await res.json() as { embeddings?: number[][]; error?: string };
  if (data.error) throw new Error(`Ollama embed: ${data.error}`);
  const emb = data.embeddings?.[0];
  if (!Array.isArray(emb) || emb.length === 0) throw new Error('Empty embedding');
  return emb;
}

async function processPaper(
  db: Database.Database, paper: Paper, deadlineMs: number
): Promise<'ok' | 'skip' | 'fail'> {
  // Hard time-gate: refuse to start a new paper if deadline is < 30s away
  if (Date.now() >= deadlineMs - 30_000) return 'skip';

  const existing = db.prepare('SELECT summary_ready FROM papers WHERE id = ?').get(paper.id) as { summary_ready: number } | undefined;
  if (existing?.summary_ready === 1) return 'skip';

  const now = new Date().toISOString();
  try {
    const [summary, embedding] = await Promise.all([
      generateSummary(paper),
      generateEmbedding(`${paper.title}\n${paper.abstract}`),
    ]);

    db.transaction(() => {
      const authorsNorm = JSON.stringify(paper.authors.map(a => a.toLowerCase()));
      db.prepare(`
        INSERT OR REPLACE INTO papers
          (id, title, authors, authors_normalized, abstract, categories,
           published_at, revised_at, pdf_url, html_url, indexed_at, summary_ready)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        paper.id, paper.title,
        JSON.stringify(paper.authors), authorsNorm,
        paper.abstract, JSON.stringify(paper.categories),
        paper.published,
        paper.updated !== paper.published ? paper.updated : null,
        paper.pdfUrl, paper.htmlUrl ?? null, now,
      );
      db.prepare(`
        INSERT OR REPLACE INTO summaries
          (paper_id, tldr, key_contributions, methods, limitations,
           beginner_explain, technical_summary, generated_at, model_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        paper.id, summary.tldr,
        JSON.stringify(summary.key_contributions), JSON.stringify(summary.methods),
        JSON.stringify(summary.limitations), summary.beginner_explain,
        summary.technical_summary, now, SUMMARY_MODEL,
      );
      db.prepare(`INSERT OR REPLACE INTO embeddings (paper_id, embedding) VALUES (?, ?)`)
        .run(paper.id, Buffer.from(new Float32Array(embedding).buffer));
    })();
    return 'ok';
  } catch (err) {
    console.error(`\n  ✗ ${paper.id}: ${err}`);
    try {
      db.prepare(`
        INSERT OR IGNORE INTO papers
          (id, title, authors, authors_normalized, abstract, categories,
           published_at, revised_at, pdf_url, html_url, indexed_at, summary_ready)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
      `).run(
        paper.id, paper.title,
        JSON.stringify(paper.authors),
        JSON.stringify(paper.authors.map((a: string) => a.toLowerCase())),
        paper.abstract, JSON.stringify(paper.categories),
        paper.published,
        paper.updated !== paper.published ? paper.updated : null,
        paper.pdfUrl, paper.htmlUrl ?? null, now,
      );
    } catch { /* ignore */ }
    return 'fail';
  }
}

async function main() {
  console.log(`\n🎯 ingest-targeted`);
  console.log(`   Categories  : ${CATEGORIES.join(', ')}`);
  console.log(`   Days back   : ${daysBack}`);
  console.log(`   Hard stop   : ${maxMin} minutes`);
  console.log(`   Summary     : ${SUMMARY_MODEL} @ ${OLLAMA_BASE}`);
  console.log(`   Embedding   : ${EMBEDDING_MODEL} @ ${OLLAMA_BASE}`);
  console.log(`   Started     : ${new Date().toISOString()}\n`);

  const startMs    = Date.now();
  const deadlineMs = startMs + maxMin * 60 * 1000;

  // Verify Ollama
  try {
    const ping = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
    console.log(`✅ Ollama reachable\n`);
  } catch (err) {
    console.error(`❌ Ollama not reachable: ${err}`); process.exit(1);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const db = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  const existingIds = new Set<string>(
    (db.prepare('SELECT id FROM papers WHERE summary_ready = 1').all() as { id: string }[]).map(r => r.id)
  );
  console.log(`Local DB: ${existingIds.size} already processed — will skip those\n`);

  let totalNew = 0, totalOk = 0, totalFail = 0, timedOut = false;

  for (const cat of CATEGORIES) {
    if (Date.now() >= deadlineMs) { timedOut = true; break; }

    console.log(`\n📚 ${cat} (${Math.round((deadlineMs - Date.now()) / 60000)}min remaining)`);
    let start = 0, catNew = 0, catOk = 0, catFail = 0;

    while (Date.now() < deadlineMs) {
      // Fetch a batch from arXiv
      let batch: Paper[];
      try {
        batch = await fetchArxivBatch(cat, start, 50);
      } catch (err) {
        console.error(`  💥 Fetch error, skipping rest of ${cat}: ${err}`);
        break;
      }
      if (batch.length === 0) { console.log(`  📭 No more results`); break; }

      let hitCutoff = false;
      const toProcess: Paper[] = [];
      for (const p of batch) {
        if (new Date(p.published) < cutoff) { hitCutoff = true; break; }
        if (!existingIds.has(p.id)) { toProcess.push(p); existingIds.add(p.id); }
      }

      // Process sequentially (Ollama is single-threaded anyway)
      for (const paper of toProcess) {
        if (Date.now() >= deadlineMs) { timedOut = true; break; }
        const result = await processPaper(db, paper, deadlineMs);
        if (result === 'ok')   { catOk++; totalOk++; catNew++; totalNew++; existingIds.add(paper.id); }
        if (result === 'fail') { catFail++; totalFail++; catNew++; totalNew++; }
        if (result === 'skip' && existingIds.has(paper.id)) continue;

        const elapsed = Math.round((Date.now() - startMs) / 1000);
        const remaining = Math.round((deadlineMs - Date.now()) / 60000);
        process.stdout.write(
          `\r  ${cat}: ✅ ${catOk} ❌ ${catFail}  |  total ✅ ${totalOk} ❌ ${totalFail}  |  ⏱ ${elapsed}s  🕐 ${remaining}min left  `
        );
      }

      if (timedOut || hitCutoff || batch.length < 50) break;
      start += 50;
    }

    console.log(`\n  → ${cat} done: ${catOk} ok, ${catFail} fail`);
    if (timedOut) break;
  }

  db.close();

  const elapsed = Math.round((Date.now() - startMs) / 1000);
  const mins = Math.floor(elapsed / 60), secs = elapsed % 60;

  console.log(`\n${'─'.repeat(60)}`);
  if (timedOut) console.log(`⏰ HARD STOP — ${maxMin}min limit reached`);
  console.log(`✅ Done: ${totalOk} ok, ${totalFail} failed, in ${mins}m ${secs}s`);
  console.log(`\nNext — push to remote:`);
  console.log(`  npx tsx scripts/push-related-to-remote.ts   # rebuild related first`);
  console.log(`  ADMIN_SECRET=xxx npm run upload-embeddings  # then embeddings`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
