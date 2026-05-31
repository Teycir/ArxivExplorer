#!/usr/bin/env tsx
/**
 * Local ingestion script using Ollama
 * Populates D1 database locally, then push to production
 * 
 * Usage:
 *   npm run ingest:local -- --limit 50
 *   wrangler d1 export arxiv-explorer --local --output backup.sql
 *   wrangler d1 execute arxiv-explorer --remote --file backup.sql
 */

import { parseStringPromise } from 'xml2js';

const OLLAMA_BASE = 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';
const SUMMARY_MODEL = 'llama3.1:8b';

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  published: string;
  updated: string;
  pdfUrl: string;
  htmlUrl?: string;
}

async function fetchArxivPapers(categories: string[], limit: number): Promise<ArxivEntry[]> {
  const papers: ArxivEntry[] = [];
  
  for (const cat of categories) {
    const url = `http://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
    const res = await fetch(url);
    const xml = await res.text();
    const parsed = await parseStringPromise(xml);
    
    const entries = parsed.feed.entry || [];
    for (const e of entries) {
      const id = e.id[0].split('/abs/')[1];
      papers.push({
        id,
        title: e.title[0].trim(),
        summary: e.summary[0].trim(),
        authors: e.author.map((a: any) => a.name[0]),
        categories: e.category.map((c: any) => c.$.term),
        published: e.published[0],
        updated: e.updated[0],
        pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
        htmlUrl: e.link?.find((l: any) => l.$.type === 'text/html')?.$?.href,
      });
    }
    
    await new Promise(r => setTimeout(r, 3000)); // Rate limit
  }
  
  return papers;
}

async function generateSummary(paper: ArxivEntry): Promise<any> {
  const prompt = `Analyze this research paper and provide a structured JSON summary.

Title: ${paper.title}
Abstract: ${paper.summary}

Return ONLY valid JSON with this exact structure:
{
  "tldr": "80-120 word summary",
  "key_contributions": ["contribution 1", "contribution 2"],
  "methods": ["method 1", "method 2"],
  "limitations": ["limitation 1", "limitation 2"],
  "beginner_explain": "Simple explanation for non-experts",
  "technical_summary": "Detailed technical summary"
}`;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      prompt,
      stream: false,
      format: 'json',
    }),
  });
  
  const data = await res.json();
  return JSON.parse(data.response);
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

async function insertPaper(paper: ArxivEntry, summary: any, embedding: number[]) {
  const now = new Date().toISOString();
  
  // Insert paper
  await fetch('http://localhost:8787/db/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `INSERT OR IGNORE INTO papers (id, title, authors, abstract, categories, published_at, revised_at, pdf_url, html_url, indexed_at, summary_ready)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      params: [
        paper.id,
        paper.title,
        JSON.stringify(paper.authors),
        paper.summary,
        JSON.stringify(paper.categories),
        paper.published,
        paper.updated,
        paper.pdfUrl,
        paper.htmlUrl || null,
        now,
      ],
    }),
  });
  
  // Insert summary
  await fetch('http://localhost:8787/db/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `INSERT OR REPLACE INTO summaries (paper_id, tldr, key_contributions, methods, limitations, beginner_explain, technical_summary, generated_at, model_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        paper.id,
        summary.tldr,
        JSON.stringify(summary.key_contributions),
        JSON.stringify(summary.methods),
        JSON.stringify(summary.limitations),
        summary.beginner_explain,
        summary.technical_summary,
        now,
        SUMMARY_MODEL,
      ],
    }),
  });
  
  // Insert embedding (you'll need to handle Vectorize separately)
  console.log(`✓ ${paper.id}: ${paper.title.slice(0, 60)}...`);
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 10;
  
  const categories = ['cs.LG', 'cs.CL', 'cs.CV', 'cs.AI'];
  
  console.log(`Fetching ${limit} papers per category from arXiv...`);
  const papers = await fetchArxivPapers(categories, limit);
  console.log(`Fetched ${papers.length} papers`);
  
  console.log('\nGenerating summaries and embeddings...');
  for (const paper of papers) {
    try {
      const summary = await generateSummary(paper);
      const embedding = await generateEmbedding(`${paper.title} ${paper.summary}`);
      await insertPaper(paper, summary, embedding);
    } catch (err) {
      console.error(`✗ ${paper.id}: ${err}`);
    }
  }
  
  console.log('\nDone! Export and push to production:');
  console.log('  wrangler d1 export arxiv-explorer --local --output backup.sql');
  console.log('  wrangler d1 execute arxiv-explorer --remote --file backup.sql');
}

main().catch(console.error);
