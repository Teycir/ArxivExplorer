#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import * as path from 'path';

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const SUMMARY_MODEL = process.env.OLLAMA_SUMMARY_MODEL || 'gemma4:e4b';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

const PROMPT = `Analyze this research paper and provide:
1. tldr: One-sentence summary (max 160 chars)
2. key_contributions: 3-5 bullet points
3. methods: 2-4 bullet points
4. limitations: 2-3 bullet points
5. beginner_explain: 3-4 sentence plain-language explanation
6. technical_summary: 2-3 sentence researcher-level summary
7. keywords: 5-10 relevant keywords
8. entities: Notable models/datasets/benchmarks mentioned
9. paper_type: "empirical"|"theoretical"|"survey"|"resource"

Respond with valid JSON only.`;

async function generateSummary(title: string, abstract: string): Promise<any> {
  const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      prompt: `${PROMPT}\n\nTitle: ${title}\n\nAbstract: ${abstract}`,
      format: 'json',
      stream: false,
    }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data: any = await r.json();
  return JSON.parse(data.response);
}

async function generateEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const d: any = await r.json();
  return d.embeddings?.[0] || [];
}

async function main() {
  const db = new Database(LOCAL_DB);
  const pending = db.prepare('SELECT id, title, abstract FROM papers WHERE summary_ready = 0').all() as any[];
  console.log(`📝 Processing ${pending.length} pending papers...\n`);

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${p.id}`);
    try {
      const summary = await generateSummary(p.title, p.abstract);
      const embedding = await generateEmbedding(`${p.title}\n\n${p.abstract}`);

      db.prepare(`INSERT OR REPLACE INTO summaries (paper_id, tldr, key_contributions, methods, limitations, beginner_explain, technical_summary, keywords, entities, paper_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(p.id, summary.tldr, JSON.stringify(summary.key_contributions), JSON.stringify(summary.methods), JSON.stringify(summary.limitations), summary.beginner_explain, summary.technical_summary, JSON.stringify(summary.keywords), JSON.stringify(summary.entities), summary.paper_type);

      db.prepare(`INSERT OR REPLACE INTO embeddings_meta (paper_id, vector, model_version) VALUES (?, ?, ?)`)
        .run(p.id, JSON.stringify(embedding), EMBEDDING_MODEL);

      db.prepare('UPDATE papers SET summary_ready = 1 WHERE id = ?').run(p.id);
      console.log(`  ✓ Done`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err}`);
      db.prepare('UPDATE papers SET summary_ready = 2 WHERE id = ?').run(p.id);
    }
  }
  db.close();
  console.log('\n✅ Complete');
}

main().catch(console.error);
