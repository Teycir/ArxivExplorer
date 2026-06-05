#!/usr/bin/env tsx
import Database from 'better-sqlite3';
import * as path from 'path';

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const OLLAMA_BASE = 'http://localhost:11434';
const SUMMARY_MODEL = 'gemma4:e4b';
const EMBEDDING_MODEL = 'nomic-embed-text';

const SYSTEM_PROMPT = 'You are a research paper summarizer. Return ONLY a valid JSON object with no preamble, explanation, or markdown fences.';

const USER_PROMPT = `Summarize this research paper abstract. Return ONLY valid JSON, no other text.

Abstract:
{abstract}

JSON format:
{
  "tldr": "One clear sentence describing what this paper does",
  "key_contributions": ["contribution 1", "contribution 2"],
  "methods": ["method 1", "method 2"],
  "limitations": ["limitation 1"],
  "beginner_explain": "Simple explanation in 2-3 sentences",
  "technical_summary": "Technical description in 3-4 sentences",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "paper_type": "empirical",
  "novelty": "One sentence describing what is novel compared to prior work",
  "problem_statement": "One sentence describing what problem this paper solves or what was broken before",
  "applications": ["application 1", "application 2"],
  "prerequisites": ["concept 1", "concept 2"],
  "follow_up_questions": ["Question 1?", "Question 2?"]
}

paper_type must be one of: empirical, theoretical, survey, dataset, position, tutorial, unknown.`;

async function generateSummary(abstract: string) {
  const prompt = USER_PROMPT.replace('{abstract}', abstract.slice(0, 4000));
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      prompt: `${SYSTEM_PROMPT}\n\n${prompt}`,
      stream: false,
      format: 'json',
      options: { temperature: 0.3, num_predict: 1024 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data: any = await res.json();
  let cleaned = data.response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
  cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

async function generateEmbedding(text: string) {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data: any = await res.json();
  return data.embedding;
}

async function main() {
  const db = new Database(LOCAL_DB);
  const pending = db.prepare('SELECT id, title, abstract FROM papers WHERE summary_ready = 0').all() as any[];
  console.log(`Processing ${pending.length} papers\n`);

  const embeddings: any[] = [];

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${p.id}`);
    try {
      const s = await generateSummary(p.abstract);
      const emb = await generateEmbedding(`${p.title}\n\n${p.abstract}`);

      db.prepare(`INSERT OR REPLACE INTO summaries (paper_id, tldr, key_contributions, methods, limitations, beginner_explain, technical_summary, generated_at, model_version, keywords, paper_type, novelty, applications, prerequisites, follow_up_questions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(p.id, s.tldr, JSON.stringify(s.key_contributions), JSON.stringify(s.methods), JSON.stringify(s.limitations), s.beginner_explain, s.technical_summary, new Date().toISOString(), SUMMARY_MODEL, JSON.stringify(s.keywords || []), s.paper_type || 'unknown', s.novelty || '', JSON.stringify(s.applications || []), JSON.stringify(s.prerequisites || []), JSON.stringify(s.follow_up_questions || []));

      db.prepare(`INSERT OR REPLACE INTO embeddings_meta (paper_id, vectorize_id, embedded_at) VALUES (?, ?, ?)`)
        .run(p.id, `paper-${p.id}`, new Date().toISOString());

      db.prepare('UPDATE papers SET summary_ready = 1 WHERE id = ?').run(p.id);
      
      embeddings.push({ id: p.id, embedding: emb });
      console.log('  ✓');
    } catch (err) {
      console.error(`  ✗ ${err}`);
      db.prepare('UPDATE papers SET summary_ready = 2 WHERE id = ?').run(p.id);
    }
  }
  db.close();
  
  require('fs').writeFileSync('embeddings-pending.json', JSON.stringify(embeddings, null, 2));
  console.log(`\n✅ Done. Embeddings saved to embeddings-pending.json`);
}

main();
