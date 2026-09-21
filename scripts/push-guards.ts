/**
 * push-guards.ts — pure safety checks for scripts/push-local-to-remote.ts
 *
 * No I/O and no dependencies, so it can be unit-tested with `node --test`
 * without installing anything.  The push script WIPES production tables, so
 * every check here fails CLOSED: if in doubt, refuse.
 */

export const PROD_DB_NAME = 'arxiv-explorer';

/** Tables the push script deletes from and re-inserts into. */
export const WIPED_TABLES = [
  'related_papers',
  'summaries',
  'embeddings_meta',
  'papers',
  'topics',
] as const;

export interface DbStats {
  papers: number;
  summaries: number;
  relatedPapers: number;
  embeddingsMeta: number;
  topics: number;
  /** papers with summary_ready = 1 */
  ready: number;
}

export interface PushOptions {
  /** --yes : required to run at all */
  yes: boolean;
  /** --allow-shrink : accept a local DB smaller than remote (dangerous) */
  allowShrink: boolean;
  /** --dry-run : print the plan, change nothing */
  dryRun: boolean;
  /** --confirm-name=<db> : must equal the target database name */
  confirmName: string;
}

export interface GuardResult {
  ok: boolean;
  /** reasons the push must NOT proceed */
  errors: string[];
  /** non-blocking observations */
  warnings: string[];
}

export function parseArgs(argv: string[]): PushOptions {
  const opts: PushOptions = { yes: false, allowShrink: false, dryRun: false, confirmName: '' };
  for (const a of argv) {
    if (a === '--yes') opts.yes = true;
    else if (a === '--allow-shrink') opts.allowShrink = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--confirm-name=')) opts.confirmName = a.slice('--confirm-name='.length);
  }
  return opts;
}

const isNonNegInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function validStats(s: DbStats | null | undefined): s is DbStats {
  return !!s && [s.papers, s.summaries, s.relatedPapers, s.embeddingsMeta, s.topics, s.ready].every(isNonNegInt);
}

/**
 * Decide whether a destructive push is allowed.
 *
 * @param local   stats of the local sqlite that would be pushed
 * @param remote  stats of the production D1 that would be overwritten,
 *                or null if it could not be read (=> refuse: we cannot
 *                prove we are not about to destroy more than we restore)
 * @param configuredDbId  CF_D1_ID from scripts/config.local.ts
 * @param expectedDbId    database_id from wrangler.api.toml
 */
export function checkPush(
  local: DbStats,
  remote: DbStats | null,
  opts: PushOptions,
  configuredDbId: string,
  expectedDbId: string,
): GuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. explicit consent, twice (flag + typed database name)
  if (!opts.yes) errors.push('missing --yes (this script DELETES production data).');
  if (opts.confirmName !== PROD_DB_NAME) {
    errors.push(`missing --confirm-name=${PROD_DB_NAME} (type the target database name).`);
  }

  // 2. we must be aiming at the database we think we are
  if (!configuredDbId || configuredDbId !== expectedDbId) {
    errors.push(
      `CF_D1_ID (${configuredDbId || 'empty'}) != database_id in wrangler.api.toml (${expectedDbId}); ` +
        'the HTTP API and wrangler would target different databases.',
    );
  }

  // 3. sanity of what we are about to push
  if (!validStats(local)) {
    errors.push('local stats are invalid/unreadable.');
    return { ok: false, errors, warnings };
  }
  if (local.papers === 0) errors.push('local DB has 0 papers: refusing to wipe production with an empty DB.');
  if (local.ready !== local.papers) {
    errors.push(`${local.papers - local.ready} local papers are not summary_ready=1 (the old check, kept).`);
  }

  // 4. we must know what we are overwriting
  if (!validStats(remote)) {
    errors.push('could not read production row counts: refusing (cannot prove this is not a downgrade).');
    return { ok: errors.length === 0, errors, warnings };
  }

  // 5. never silently shrink production — compare EVERY wiped table
  const pairs: Array<[string, number, number]> = [
    ['papers', local.papers, remote.papers],
    ['summaries', local.summaries, remote.summaries],
    ['related_papers', local.relatedPapers, remote.relatedPapers],
    ['embeddings_meta', local.embeddingsMeta, remote.embeddingsMeta],
    ['topics', local.topics, remote.topics],
  ];
  for (const [name, l, r] of pairs) {
    if (l < r) {
      const msg = `${name}: local ${l} < production ${r} (would LOSE ${r - l} rows).`;
      if (opts.allowShrink) warnings.push(`${msg} Allowed by --allow-shrink.`);
      else errors.push(msg + ' Use --allow-shrink only if you really mean it.');
    }
  }

  // 6. a big relative drop is suspicious even with --allow-shrink
  if (remote.papers > 0 && local.papers < remote.papers * 0.5) {
    warnings.push(`local has less than half of production's papers (${local.papers} vs ${remote.papers}).`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
