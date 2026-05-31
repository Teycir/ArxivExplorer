#!/usr/bin/env tsx
/**
 * Process existing papers in local database
 * Generates summaries and embeddings for papers that don't have them yet
 */

import Database from 'better-sqlite3';

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';
const SUMMARY_MODEL = 'qwen3.5:4b';

interface Paper {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  categories: string;
}

async function generateSummary(paper: Paper): Promise<any> {
  const prompt = `Analyze this CS research paper and provide a structured JSON summary.

Title: ${paper.title}
Abstract: ${paper.abstract.slice(0, 1000)}

Return ONLY valid JSON with this exact structure:
{
  "tldr": "80-120 word summary",
  "key_contributions": ["contribution 1", "contribution 2"],
  "methods": ["method 1", "method 2"],
  "limitations": ["limitation 1"],
  "beginner_explain": "Simple explanation",
  "technical_summary": "Technical details"
}`;

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.3,
          num_predict: 1000,
        },
      }),
    });
    
    const data = await res.json();
    const response = (data.response || data.thinking || '').trim();
    
    if (!response) {
      throw new Error('Empty response from Ollama');
    }
    
    // Try to extract JSON if wrapped in markdown
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) || response.match(/```\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response;
    
    return JSON.parse(jsonStr);
  } catch (err) {
    // Fallback to simple summary
    return {
      tldr: paper.abstract.slice(0, 120),
      key_contributions: ["See abstract"],
      methods: ["See paper"],
      limitations: ["Not analyzed"],
      beginner_explain: paper.abstract.slice(0, 200),
      technical_summary: paper.abstract,
    };
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text,
    }),
  });
  
  const data = await res.json();
  return data.embedding;
}

async function processPaper(db: Database.Database, paper: Paper): Promise<void> {
  const now = new Date().toISOString();
  
  try {
    // Generate summary and embedding
    const summary = await generateSummary(paper);
    const embedding = await generateEmbedding(`${paper.title} ${paper.abstract}`);
    
    // Insert summary
    db.prepare(`
      INSERT OR REPLACE INTO summaries (paper_id, tldr, key_contributions, methods, limitations, beginner_explain, technical_summary, generated_at, model_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paper.id,
      summary.tldr,
      JSON.stringify(summary.key_contributions),
      JSON.stringify(summary.methods),
      JSON.stringify(summary.limitations),
      summary.beginner_explain,
      summary.technical_summary,
      now,
      SUMMARY_MODEL,
    );
    
    // Store embedding as blob
    const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
    db.prepare(`INSERT OR REPLACE INTO embeddings (paper_id, embedding) VALUES (?, ?)`).run(paper.id, embeddingBuffer);
    
    // Mark paper as ready
    db.prepare(`UPDATE papers SET summary_ready = 1 WHERE id = ?`).run(paper.id);
    
    console.log(`✓ ${paper.id}: ${paper.title.slice(0, 60)}...`);
  } catch (err) {
    console.error(`✗ ${paper.id}: ${err}`);
    // Mark as failed
    db.prepare(`UPDATE papers SET summary_ready = 2 WHERE id = ?`).run(paper.id);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const batchIdx = args.indexOf('--batch');
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1]) : 5;
  
  const db = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
  
  // Get papers that need processing (summary_ready = 0, 2, or NULL)
  const papers = db.prepare(`
    SELECT id, title, abstract, authors, categories 
    FROM papers 
    WHERE summary_ready != 1 OR summary_ready IS NULL
  `).all() as Paper[];
  
  console.log(`Found ${papers.length} papers to process\n`);
  
  if (papers.length === 0) {
    console.log('No papers to process!');
    db.close();
    return;
  }
  
  console.log(`Processing ${batchSize} papers at a time...\n`);
  for (let i = 0; i < papers.length; i += batchSize) {
    const batch = papers.slice(i, i + batchSize);
    await Promise.all(batch.map(p => processPaper(db, p)));
    console.log(`Progress: ${Math.min(i + batchSize, papers.length)}/${papers.length}\n`);
  }
  
  db.close();
  
  console.log('\n✅ Processing complete!');
  console.log('\nNext steps:');
  console.log('1. Export: npm run db:export');
  console.log('2. Push to production: npm run db:push');
  console.log('3. Upload embeddings: npm run ingest:upload-embeddings');
}

main().catch(console.error);
