#!/usr/bin/env tsx
/**
 * scripts/bench-summary-models.ts
 *
 * Runs the production generateSummary() with several Ollama models on the SAME
 * papers and reports speed + a few objective quality signals, so the choice of
 * a lighter model is measured, not guessed.
 *
 * Read-only: opens the local DB with { readonly: true } and writes nothing.
 * The comparison set is papers ALREADY summarised by the reference model, so
 * each candidate can be compared against an existing summary.
 *
 * Usage: npx tsx scripts/bench-summary-models.ts gemma3:4b granite4.2 --n 6
 *        (reference model defaults to gemma4:e4b, override with --ref)
 */
import Database from 'better-sqlite3';
import { generateSummary } from '../src/ingest-worker/generate-summary';

const DB_PATH = process.env.LOCAL_DB ?? '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite';
const OLLAMA_BASE = process.env.OLLAMA_BASE ?? 'http://localhost:11434';

interface Row { id: string; abstract: string }
interface Result { ms: number; ok: boolean; err?: string; fields?: Record<string, number>; tldrWords?: number; grounded?: number }

const STOP = new Set('the a an of and or to in for on with by is are was were be this that these those it its as at from we our can which has have not but also using use used based paper propose proposed show shows new results method methods approach'.split(' '));
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter(w => !STOP.has(w));

/** Share of the summary's content words that actually occur in the abstract (hallucination proxy). */
function grounded(summaryText: string, abstract: string): number {
  const src = new Set(words(abstract)), sw = words(summaryText);
  return sw.length ? sw.filter(w => src.has(w)).length / sw.length : 0;
}

async function vramInfo(model: string): Promise<string> {
  try {
    const d = await (await fetch(`${OLLAMA_BASE}/api/ps`)).json() as { models?: Array<{ name: string; size: number; size_vram: number }> };
    const m = d.models?.find(x => x.name === model || x.name.startsWith(model));
    return m ? `${(m.size_vram / m.size * 100).toFixed(0)}% on GPU (${(m.size / 1e9).toFixed(1)}GB)` : 'n/a';
  } catch { return 'n/a'; }
}

async function unload(model: string): Promise<void> {
  await fetch(`${OLLAMA_BASE}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
}

async function main() {
  const args = process.argv.slice(2);
  const n = Number(args[args.indexOf('--n') + 1]) || 5;
  const refIdx = args.indexOf('--ref');
  const ref = refIdx >= 0 ? args[refIdx + 1]! : 'gemma4:e4b';
  const models = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--n' && args[i - 1] !== '--ref');
  if (!models.length) throw new Error('give at least one model to test');

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(
    `SELECT p.id, p.abstract FROM papers p JOIN summaries s ON s.paper_id = p.id
     WHERE s.model_version = ? AND p.summary_ready = 1 ORDER BY p.indexed_at DESC LIMIT ?`
  ).all(ref, n) as Row[];
  console.log(`Bench: ${n} papers already summarised by ${ref} | candidates: ${models.join(', ')}\n`);

  const all: Record<string, Result[]> = {};
  for (const model of [ref, ...models]) {
    await unload(model); // cold start each, fair comparison of load cost is reported separately
    const out: Result[] = [];
    let placement = 'n/a';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const t = Date.now();
      try {
        const s = await generateSummary(r.abstract, { OLLAMA_BASE, OLLAMA_SUMMARY_MODEL: model } as never);
        const text = [s.tldr, s.beginner_explain, s.technical_summary, ...s.key_contributions, ...s.methods].join(' ');
        out.push({
          ms: Date.now() - t, ok: true, tldrWords: s.tldr.split(/\s+/).length, grounded: grounded(text, r.abstract),
          fields: { kw: s.keywords.length, contrib: s.key_contributions.length, fq: s.follow_up_questions.length, prob: s.problem_statement ? 1 : 0 },
        });
      } catch (e) {
        out.push({ ms: Date.now() - t, ok: false, err: String(e instanceof Error ? e.message : e).replace(/\s+/g, ' ').slice(0, 80) });
      }
      if (i === 0) placement = await vramInfo(model);
      process.stdout.write(`\r  ${model.padEnd(16)} ${i + 1}/${rows.length}   `);
    }
    console.log(`\r  ${model.padEnd(16)} done. placement: ${placement}          `);
    all[model] = out;
    await unload(model);
  }

  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  console.log('\nmodel              ok    first(s)  steady(s)  papers/h  tldr_words  grounded  kw  contrib  followup  problem');
  for (const [model, res] of Object.entries(all)) {
    const good = res.filter(r => r.ok);
    const steady = good.slice(1).map(r => r.ms / 1000);
    const perPaper = avg(steady.length ? steady : good.map(r => r.ms / 1000));
    const f = (k: string) => avg(good.map(r => r.fields![k]!)).toFixed(1);
    console.log(
      `${model.padEnd(18)} ${String(good.length).padStart(2)}/${res.length}  ${(good[0] ? good[0].ms / 1000 : 0).toFixed(1).padStart(8)}  ${perPaper.toFixed(1).padStart(9)}  ${(perPaper ? 3600 / perPaper : 0).toFixed(0).padStart(8)}  ` +
      `${avg(good.map(r => r.tldrWords!)).toFixed(0).padStart(10)}  ${(avg(good.map(r => r.grounded!)) * 100).toFixed(0).padStart(7)}%  ${f('kw').padStart(2)}  ${f('contrib').padStart(7)}  ${f('fq').padStart(8)}  ${(avg(good.map(r => r.fields!.prob!)) * 100).toFixed(0).padStart(6)}%`,
    );
    const errs = res.filter(r => !r.ok).map(r => r.err); if (errs.length) console.log(`   errors: ${[...new Set(errs)].join(' | ')}`);
  }
  db.close();
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
