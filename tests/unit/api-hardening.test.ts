/**
 * tests/unit/api-hardening.test.ts
 *
 * Regression guards for the classes of bug behind the September 2026 D1
 * free-tier quota outage (see the CHANGELOG post-mortem).
 *
 * These are deliberately source-scanning assertions: they need no Cloudflare
 * bindings, no database and no network, so they run in any CI and fail the
 * moment someone reintroduces one of the query shapes that read 88 % of the
 * account's daily row budget.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Extracts a function (signature → balanced closing brace) from a source file. */
function extractFunction(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `signature not found: ${signature}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after: ${signature}`);
}

/**
 * Drops comments before pattern checks — the doc comments here legitimately
 * *mention* the query shapes they replaced ("…used to run COUNT(*)…"), and
 * scanning them would make these guards false-pass/false-fail.
 *
 * Line comments are only stripped when `//` starts the line (after indent), so
 * `https://` inside string literals survives.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

// ── 1. Every public route must be rate limited ────────────────────────────────
//
// BEFORE: only 7 of 10 public routes were wrapped. /api/topics, /api/stats and
// /api/sitemap were reachable with no limiter at all — measured as 0×429 out of
// 200 parallel requests — and those three are the D1-heaviest endpoints.

const NOT_RATE_LIMITED = new Map<string, string>([
  ['claim.ts', 'calls checkRateLimit() directly for the per-user AI budget'],
  ['admin.ts', 'gated by ADMIN_SECRET with constant-time comparison'],
]);

describe('rate limiting coverage', () => {
  const routesDir = join(ROOT, 'src', 'api-worker', 'routes');
  const files = readdirSync(routesDir).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    if (NOT_RATE_LIMITED.has(file)) continue;
    it(`${file} wraps its handler in withRateLimit`, () => {
      const src = readFileSync(join(routesDir, file), 'utf8');
      assert.ok(
        src.includes('withRateLimit('),
        `${file} is reachable by crawlers but has no rate limiter — this is exactly ` +
        `how /api/topics, /api/stats and /api/sitemap exhausted the D1 free-tier ` +
        `daily row-read budget on 2026-09-23. Wrap it in withRateLimit() or add it ` +
        `to NOT_RATE_LIMITED with a reason.`
      );
    });
  }

  it('covers the three endpoints from the incident by name', () => {
    for (const name of ['topics.ts', 'stats.ts', 'sitemap.ts']) {
      const src = readFileSync(join(routesDir, name), 'utf8');
      assert.ok(src.includes('withRateLimit('), `${name} must be rate limited`);
    }
  });
});

// ── 2. Crawler surface ────────────────────────────────────────────────────────
//
// A specific robots.txt user-agent group REPLACES the `*` group for that crawler.
// Giving GPTBot & co a bare `allow: '/'` therefore REMOVED the `Disallow: /api/`
// that kept them off the JSON API, and llms.txt advertised those URLs directly.

describe('crawler surface', () => {
  it('every robots.txt group disallows /api/', () => {
    const robots = stripComments(read('app/robots.ts'));
    const groups = robots.match(/userAgent:\s*'[^']+'[^}]*}/g);
    assert.ok((groups ?? []).length >= 2, 'expected a robots rule list');
    for (const group of groups ?? []) {
      const agent = group.match(/'([^']+)'/)?.[1] ?? '?';
      assert.match(group, /'\/api\/'/,
        `robots rule for "${agent}" does not disallow /api/ — a specific group ` +
        `overrides the * group, so crawlers would be invited to the JSON API`);
    }
  });

  it('llms.txt does not advertise the raw JSON API', () => {
    const llms = stripComments(read('app/llms.txt/route.ts'));
    assert.doesNotMatch(llms, /arxiv-api\.arxivexplorer\.workers\.dev\/api/,
      'advertising the JSON endpoints tells crawlers exactly which D1-heavy URLs to hammer');
  });
});

// ── 3. The measured top query offenders must not come back ────────────────────
//
// Measured with `wrangler d1 insights --timePeriod=7d` (the outage window):
//   #1 SELECT COUNT(DISTINCT p.id) … papers_fts  42,226,877 rows read (52 %)
//   #2 batch paper fetch                         20,807,124 rows read (26 %)
//   #3 SELECT COUNT(*) … summary_ready = 1        8,138,676 rows read (10 %)
// against a free-tier budget of 5,000,000 rows/day.

describe('query cost guards', () => {
  it('getTopicsWithPapers reads materialized counts, not live FTS joins', () => {
    const db = read('src/shared/db.ts');
    const fn = extractFunction(stripComments(db), 'export async function getTopicsWithPapers');
    assert.doesNotMatch(fn, /papers_fts\s+MATCH/,
      'per-topic counting must not run on a request path — it cost 42.2 M rows read / 7 days');
    assert.match(fn, /paper_count/, 'expected the materialized topics.paper_count column');
  });

  it('/api/stats reads counters instead of scanning papers', () => {
    const stats = stripComments(read('src/api-worker/routes/stats.ts'));
    assert.doesNotMatch(stats, /COUNT\(DISTINCT/,
      'live FTS count joins in a request path reintroduce the outage');
    assert.doesNotMatch(stats, /COUNT\(\*\)/,
      'COUNT(*) per request cost 8.1 M rows read / 7 days just to render a badge');
    assert.match(stats, /getAggregateCounts/);
  });

  it('the expensive count joins live only in refreshTopicCounts (the cron path)', () => {
    const db = read('src/shared/db.ts');
    const refresh = extractFunction(stripComments(db), 'export async function refreshTopicCounts');
    assert.match(refresh, /papers_fts\s+MATCH/, 'the cron path is where recomputation belongs');

    for (const name of ['getTopicsWithPapers', 'getAggregateCounts']) {
      const fn = extractFunction(stripComments(db), `export async function ${name}`);
      assert.doesNotMatch(fn, /papers_fts\s+MATCH/,
        `${name} must read materialized values, not recompute them`);
    }
  });

  it('the ingest cron actually calls refreshTopicCounts', () => {
    const pipeline = stripComments(read('src/ingest-worker/pipeline.ts'));
    assert.match(pipeline, /refreshTopicCounts\(/,
      'if the cron stops refreshing, /api/topics would report paper_count = 0 for every topic');
    assert.match(pipeline, /refreshMaterializedCounts\(/);
  });

  it('trending does not query D1 on cache hits', () => {
    const trending = stripComments(read('src/api-worker/routes/trending.ts'));
    assert.doesNotMatch(trending, /JOIN summaries s ON s\.paper_id = p\.id/,
      'a staleness query on every request costs a D1 read per page view');
  });
});
