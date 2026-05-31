#!/usr/bin/env tsx
/**
 * Bulk CS arXiv ingestion with Ollama - FULLY SEQUENTIAL
 * - Fetches ALL 40 CS categories
 * - 5-second delay between each arXiv API request
 * - NO parallel processing (one paper at a time)
 * - Skips duplicates automatically
 * 
 * Usage:
 *   npm run ingest:bulk -- --days 7
 */

import { parseStringPromise } from 'xml2js';
import Database from 'better-sqlite3';
import fs from 'fs';

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';
const SUMMARY_MODEL = 'qwen3.5:4b';

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

async function initLocalDB(): Promise<Database.Database> {
  const db = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
  
  // Ensure tables exist
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
    
    CREATE TABLE IF NOT EXISTS embeddings (
      paper_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id)
    );
  `);
  
  return db;
}

async function processPaper(db: Database.Database, paper: Paper): Promise<void> {
  const now = new Date().toISOString();
  
  // Check if already exists
  const existing = db.prepare('SELECT id FROM papers WHERE id = ?').get(paper.id);
  if (existing) {
    console.log(`⊘ ${paper.id}: Already exists, skipping`);
    return;
  }
  
  try {
    // Generate summary and embedding SEQUENTIALLY (no parallel)
    const summary = await generateSummary(paper);
    const embedding = await generateEmbedding(`${paper.title} ${paper.abstract}`);
    
    // Insert paper
    db.prepare(`
      INSERT OR REPLACE INTO papers (id, title, authors, abstract, categories, published_at, revised_at, pdf_url, html_url, comment, journal_ref, doi, primary_category, indexed_at, summary_ready)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      paper.id,
      paper.title,
      JSON.stringify(paper.authors),
      paper.abstract,
      JSON.stringify(paper.categories),
      paper.published,
      paper.updated,
      paper.pdfUrl,
      paper.htmlUrl || null,
      paper.comment || null,
      paper.journalRef || null,
      paper.doi || null,
      paper.primaryCategory || null,
      now,
    );
    
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
    
    console.log(`✓ ${paper.id}: ${paper.title.slice(0, 60)}...`);
  } catch (err) {
    console.error(`✗ ${paper.id}: ${err}`);
    // Mark as failed
    db.prepare(`
      INSERT OR REPLACE INTO papers (id, title, authors, abstract, categories, published_at, revised_at, pdf_url, html_url, comment, journal_ref, doi, primary_category, indexed_at, summary_ready)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
    `).run(
      paper.id,
      paper.title,
      JSON.stringify(paper.authors),
      paper.abstract,
      JSON.stringify(paper.categories),
      paper.published,
      paper.updated,
      paper.pdfUrl,
      paper.htmlUrl || null,
      paper.comment || null,
      paper.journalRef || null,
      paper.doi || null,
      paper.primaryCategory || null,
      now,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  
  const daysBack = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : 7;
  
  console.log(`\n⚠️  CONSERVATIVE MODE - NO PARALLEL PROCESSING`);
  console.log(`Fetching ALL CS categories (40 categories)`);
  console.log(`Days back: ${daysBack}`);
  console.log(`5-second delay between each arXiv request`);
  console.log(`Papers processed ONE AT A TIME (sequential)`);
  console.log(`Estimated time: 2-4 hours\n`);
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  
  const allPapers: Paper[] = [];
  const seen = new Set<string>();
  
  // Fetch from ALL CS categories
  for (const cat of CS_CATEGORIES) {
    console.log(`\nFetching ${cat}...`);
    let start = 0;
    const fetchSize = 50;
    
    while (true) {
      const batch = await fetchArxivBatch(cat, start, fetchSize);
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
      
      if (hitCutoff || batch.length < fetchSize) break;
      start += fetchSize;
    }
  }
  
  console.log(`\nFound ${allPapers.length} papers\n`);
  
  console.log('Initializing local database...');
  const db = await initLocalDB();
  
  console.log(`Processing papers ONE AT A TIME (no parallel)...\n`);
  
  // Process papers SEQUENTIALLY - no parallel processing
  for (let i = 0; i < allPapers.length; i++) {
    await processPaper(db, allPapers[i]);
    console.log(`Progress: ${i + 1}/${allPapers.length}\n`);
  }
  
  db.close();
  
  console.log('\n✅ Bulk ingestion complete!');
  console.log('\nNext steps:');
  console.log('1. Export: npm run db:export');
  console.log('2. Push to production: npm run db:push');
  console.log('3. Upload embeddings: npm run ingest:upload-embeddings');
}

main().catch(console.error);
