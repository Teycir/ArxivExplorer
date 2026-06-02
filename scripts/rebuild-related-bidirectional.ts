/**
 * scripts/rebuild-related-bidirectional.ts
 * 
 * Rebuilds the related_papers table with bidirectional relationships.
 * Run this once after deploying the new bidirectional algorithm.
 * 
 * Usage:
 *   npx tsx scripts/rebuild-related-bidirectional.ts
 */

import { buildTf, findSimilar, type CorpusEntry } from '../src/ingest-worker/tfidf';

const REMOTE_API_BASE = process.env.API_BASE || 'https://arxiv-api.teycir.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const CORPUS_SIZE = 600;
const TOP_K = 8;

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET environment variable required');
  process.exit(1);
}

interface Paper {
  id: string;
  title: string;
  abstract: string;
}

async function fetchAllPapers(): Promise<Paper[]> {
  console.log('📥 Fetching all summarized papers from remote D1...');
  
  const response = await fetch(`${REMOTE_API_BASE}/admin/papers/all`, {
    headers: { 'x-admin-secret': ADMIN_SECRET },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch papers: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { papers: Paper[] };
  console.log(`✅ Fetched ${data.papers.length} papers`);
  return data.papers;
}

async function clearRelatedPapers(): Promise<void> {
  console.log('🗑️  Clearing existing related_papers table...');
  
  const response = await fetch(`${REMOTE_API_BASE}/admin/related/clear`, {
    method: 'POST',
    headers: { 'x-admin-secret': ADMIN_SECRET },
  });

  if (!response.ok) {
    throw new Error(`Failed to clear: ${response.status} ${await response.text()}`);
  }

  console.log('✅ Cleared related_papers table');
}

async function bulkInsertRelated(rows: Array<{
  paperId: string;
  relatedId: string;
  score: number;
  rank: number;
}>): Promise<void> {
  const response = await fetch(`${REMOTE_API_BASE}/admin/related/bulk-insert`, {
    method: 'POST',
    headers: {
      'x-admin-secret': ADMIN_SECRET,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ rows }),
  });

  if (!response.ok) {
    throw new Error(`Bulk insert failed: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  console.log('🚀 Rebuilding related_papers with bidirectional algorithm\n');

  // 1. Fetch all papers
  const papers = await fetchAllPapers();
  
  if (papers.length === 0) {
    console.log('No papers to process');
    return;
  }

  // 2. Clear existing data
  await clearRelatedPapers();

  // 3. Build TF maps for all papers
  console.log('\n📊 Building TF-IDF corpus...');
  const corpus: CorpusEntry[] = papers.map(p => ({
    id: p.id,
    tf: buildTf(`${p.title} ${p.title} ${p.abstract}`),
  }));
  console.log(`✅ Corpus built with ${corpus.length} papers\n`);

  // 4. Compute related papers for each paper
  console.log('🔄 Computing bidirectional related papers...');
  const allRows: Array<{
    paperId: string;
    relatedId: string;
    score: number;
    rank: number;
  }> = [];

  let processed = 0;
  for (const entry of corpus) {
    const similar = findSimilar(entry.id, entry.tf, corpus, TOP_K);
    
    similar.forEach((item, idx) => {
      allRows.push({
        paperId: entry.id,
        relatedId: item.id,
        score: item.score,
        rank: idx + 1,
      });
    });

    processed++;
    if (processed % 50 === 0) {
      console.log(`  Processed ${processed}/${corpus.length} papers...`);
    }
  }

  console.log(`✅ Computed ${allRows.length} total relationships\n`);

  // 5. Bulk insert in batches
  console.log('💾 Writing to D1...');
  const BATCH_SIZE = 500;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await bulkInsertRelated(batch);
    console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allRows.length / BATCH_SIZE)}`);
  }

  console.log('\n✅ Done! Related papers rebuilt successfully.');
  console.log(`   Total relationships: ${allRows.length}`);
  console.log(`   Average per paper: ${(allRows.length / corpus.length).toFixed(1)}`);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
