#!/usr/bin/env tsx
/**
 * scripts/enrich-opencitations.ts
 * Fetch citation data from OpenCitations COCI (1B+ citations, CC0, no API key)
 * Complements Semantic Scholar with open citation data
 * 
 * Usage:
 *   npx tsx scripts/enrich-opencitations.ts [--limit 100]
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const OPENCITATIONS_BASE = 'https://api.opencitations.net/index/v1';
const DELAY_MS = 200; // Polite usage
const BATCH_SIZE = 50;

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const db = new Database(LOCAL_DB);
db.pragma('journal_mode = WAL');

interface Citation {
  citing: string;
  cited: string;
  creation: string;
}

async function getCitations(doi: string): Promise<{ citing: number; cited: number } | null> {
  try {
    // Get papers citing this DOI
    const citingRes = await fetch(`${OPENCITATIONS_BASE}/citations/${encodeURIComponent(doi)}`);
    const citing = citingRes.ok ? (await citingRes.json() as Citation[]).length : 0;
    
    await delay(DELAY_MS);
    
    // Get papers cited by this DOI (references)
    const citedRes = await fetch(`${OPENCITATIONS_BASE}/references/${encodeURIComponent(doi)}`);
    const cited = citedRes.ok ? (await citedRes.json() as Citation[]).length : 0;
    
    return citing > 0 || cited > 0 ? { citing, cited } : null;
  } catch (err: any) {
    console.error(`Failed to fetch ${doi}: ${err.message}`);
    return null;
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc = (s: string) => s.replace(/'/g, "''");

async function main() {
  const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 100;
  
  console.log(`📚 OpenCitations COCI enrichment (no API key)\n`);
  
  // Get papers with DOI but no OpenCitations data yet
  const papers = db.prepare(`
    SELECT id, doi 
    FROM papers 
    WHERE doi IS NOT NULL 
      AND (opencitations_enriched_at IS NULL OR opencitations_enriched_at = '')
    ORDER BY indexed_at DESC
    LIMIT ?
  `).all(limit) as { id: string; doi: string }[];
  
  console.log(`Found ${papers.length} papers with DOIs to check\n`);
  if (!papers.length) {
    console.log('✅ Nothing to do');
    return;
  }
  
  let found = 0, notFound = 0, failed = 0;
  const batch: string[] = [];
  const now = new Date().toISOString();
  
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i]!;
    
    try {
      const data = await getCitations(paper.doi);
      await delay(DELAY_MS);
      
      if (data) {
        batch.push(`
          UPDATE papers 
          SET oc_citation_count = ${data.citing},
              oc_reference_count = ${data.cited},
              opencitations_enriched_at = '${now}'
          WHERE id = '${esc(paper.id)}'
        `);
        found++;
      } else {
        // Mark as checked even if no citations
        batch.push(`
          UPDATE papers 
          SET opencitations_enriched_at = '${now}'
          WHERE id = '${esc(paper.id)}'
        `);
        notFound++;
      }
    } catch (err) {
      console.error(`\n❌ ${paper.id}: ${err}`);
      failed++;
    }
    
    if (batch.length >= BATCH_SIZE) {
      db.exec(batch.join(';\n'));
      batch.length = 0;
    }
    
    process.stdout.write(`\r   ${i + 1}/${papers.length}  found:${found}  none:${notFound}  fail:${failed}  `);
  }
  
  if (batch.length) db.exec(batch.join(';\n'));
  db.close();
  
  console.log(`\n\n✅ Done — Citations found: ${found}/${papers.length} (${Math.round(found/papers.length*100)}%)`);
  console.log(`\nNext: run push-local-to-remote.ts to sync`);
}

main().catch(e => {
  console.error('\n❌', e.message);
  process.exit(1);
});
