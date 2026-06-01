import { CF_TOKEN, CF_ACCOUNT_ID } from './config.local.ts';

const D1_ID = '67fa825b-9f3e-478c-99d2-3e5cc1b0f3de';
const BASE_D1 = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_ID}`;
const HEADERS = { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };

async function d1q(sql: string, params: any[] = []) {
  const r = await fetch(`${BASE_D1}/query`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ sql, params }) });
  const d: any = await r.json();
  return d.result?.[0]?.results ?? [];
}

async function main() {
  // Check ALL 17 failed papers - what do they look like in full?
  console.log('=== 17 FAILED PAPERS DETAIL ===');
  const failed = await d1q(
    "SELECT id, title, summary_ready, indexed_at FROM papers WHERE summary_ready=2 ORDER BY indexed_at DESC LIMIT 20"
  );
  failed.forEach((r: any) => console.log(r.summary_ready, r.id, r.indexed_at.slice(0,19), r.title?.slice(0,55)));

  // Check summary integrity for summary_ready=1 papers
  // Find papers where summary row is missing despite summary_ready=1
  console.log('\n=== summary_ready=1 BUT NO SUMMARY ROW ===');
  const noSummaryRow = await d1q(
    `SELECT p.id, p.title, p.indexed_at FROM papers p
     WHERE p.summary_ready = 1
     AND NOT EXISTS (SELECT 1 FROM summaries s WHERE s.paper_id = p.id)
     LIMIT 20`
  );
  console.log('Count:', noSummaryRow.length);
  noSummaryRow.forEach((r: any) => console.log(r.id, r.title?.slice(0,60)));

  // Check for papers with summary row but empty/null tldr
  console.log('\n=== summary_ready=1 WITH EMPTY TLDR ===');
  const emptyTldr = await d1q(
    `SELECT p.id, p.title, s.tldr FROM papers p
     JOIN summaries s ON s.paper_id = p.id
     WHERE p.summary_ready = 1 AND (s.tldr IS NULL OR s.tldr = '')
     LIMIT 10`
  );
  console.log('Count:', emptyTldr.length);
  emptyTldr.forEach((r: any) => console.log(r.id, '| tldr:', r.tldr));

  // Full summary for 2605.31035 to verify all fields present
  console.log('\n=== FULL SUMMARY for 2605.31035 ===');
  const full = await d1q(
    `SELECT p.summary_ready, s.tldr, s.key_contributions, s.methods, s.limitations, s.beginner_explain, s.technical_summary
     FROM papers p LEFT JOIN summaries s ON s.paper_id=p.id WHERE p.id=?`,
    ['2605.31035']
  );
  const row: any = full[0];
  if (row) {
    console.log('summary_ready:', row.summary_ready);
    console.log('tldr:', row.tldr);
    console.log('key_contributions:', row.key_contributions?.slice(0,80));
    console.log('methods:', row.methods?.slice(0,80));
    console.log('limitations:', row.limitations?.slice(0,80));
    console.log('beginner_explain:', row.beginner_explain?.slice(0,100));
    console.log('technical_summary:', row.technical_summary?.slice(0,100));
  }

  // Also check ISR/Next.js revalidate cache issue — look at papers around 2605.31035
  // to understand if it's a Next.js ISR cache serving stale HTML
  console.log('\n=== PAPERS AROUND 2605.31035 (sample check) ===');
  const nearby = await d1q(
    `SELECT id, summary_ready, (SELECT COUNT(*) FROM related_papers r WHERE r.paper_id=p.id) as rel_count
     FROM papers p WHERE id LIKE '2605.31%' ORDER BY id LIMIT 15`
  );
  nearby.forEach((r: any) => console.log(r.id, 'ready='+r.summary_ready, 'related='+r.rel_count));
}

main().catch(e => { console.error(e); process.exit(1); });
