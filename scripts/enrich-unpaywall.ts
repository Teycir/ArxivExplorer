#!/usr/bin/env tsx
/**
 * scripts/enrich-unpaywall.ts
 * Fetch open access PDF links from Unpaywall API for papers with DOIs
 * No API key required - just polite email parameter
 * 
 * Usage:
 *   npx tsx scripts/enrich-unpaywall.ts [--limit 100]
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const UNPAYWALL_EMAIL = 'teycir@pxdmail.net';
const DELAY_MS = 500; // Be polite
const BATCH_SIZE = 50;

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const db = new Database(LOCAL_DB);
db.pragma('journal_mode = WAL');

interface UnpaywallResponse {
  doi: string;
  is_oa: boolean;
  best_oa_location?: {
    url: string;
    url_for_pdf?: string;
    url_for_landing_page?: string;
    license?: string;
    version?: string; // 'publishedVersion', 'acceptedVersion', 'submittedVersion'
  };
}

async function fetchUnpaywall(doi: string): Promise<UnpaywallResponse | null> {
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`;
  
  try {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: any) {
    console.error(`Failed to fetch ${doi}: ${err.message}`);
    return null;
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc = (s: string) => s.replace(/'/g, "''");

async function main() {
  const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 9999;
  
  console.log(`🔓 Unpaywall OA enrichment (${UNPAYWALL_EMAIL})\n`);
  
  // Get papers with DOI but no oa_url yet
  const papers = db.prepare(`
    SELECT id, doi 
    FROM papers 
    WHERE doi IS NOT NULL 
      AND (oa_url IS NULL OR oa_url = '')
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
      const data = await fetchUnpaywall(paper.doi);
      await delay(DELAY_MS);
      
      if (data?.is_oa && data.best_oa_location) {
        const loc = data.best_oa_location;
        const pdfUrl = loc.url_for_pdf || loc.url;
        
        batch.push(`
          UPDATE papers 
          SET oa_url = '${esc(pdfUrl)}',
              oa_license = ${loc.license ? `'${esc(loc.license)}'` : 'NULL'},
              oa_version = ${loc.version ? `'${esc(loc.version)}'` : 'NULL'},
              unpaywall_enriched_at = '${now}'
          WHERE id = '${esc(paper.id)}'
        `);
        found++;
      } else {
        // Mark as checked even if not OA
        batch.push(`
          UPDATE papers 
          SET unpaywall_enriched_at = '${now}'
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
    
    process.stdout.write(`\r   ${i + 1}/${papers.length}  found:${found}  not-oa:${notFound}  fail:${failed}  `);
  }
  
  if (batch.length) db.exec(batch.join(';\n'));
  db.close();
  
  console.log(`\n\n✅ Done — OA links found: ${found}/${papers.length} (${Math.round(found/papers.length*100)}%)`);
  console.log(`\nNext: run push-local-to-remote.ts to sync`);
}

main().catch(e => {
  console.error('\n❌', e.message);
  process.exit(1);
});
