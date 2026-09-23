/**
 * src/shared/db-budget.ts
 * Per-request D1 rows-read accounting and free-tier quota error handling.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The September 2026 outage was not noticed until Cloudflare started rejecting
 * queries, even though the account had been reading ~11.5 M rows/day against a
 * 5 M rows/day free-tier budget for weeks — a sustained 2.3× overrun (measured
 * with `wrangler d1 insights`). D1 returns the exact `meta.rows_read` for every
 * query, so the cost is measurable: this wrapper accumulates it per request and
 * logs one warning as soon as a request crosses its budget. That turns "we are
 * over budget" into a visible log line instead of a once-a-day 500.
 *
 * COVERAGE: `all()`, `run()`, `raw()` and `batch()` report `meta`. `.first()`
 * returns the row value itself (no meta) in the Workers binding, so queries that
 * use `.first()` are NOT counted here — the cron path that runs the expensive
 * count joins uses `batch()` precisely so its cost is measured.
 */

/** Rows a single request may read before we log a warning. */
export const REQUEST_ROW_BUDGET = 5_000;

/** Subset of D1's query metadata we care about. */
interface D1QueryMeta {
  rows_read?: number;
  rows_written?: number;
}

interface BudgetState {
  rowsRead: number;
  queries: number;
  warned: boolean;
}

/**
 * Wraps a D1 binding so the rows read by each request are summed and compared
 * against `budget`. Returns a drop-in replacement — the proxy forwards every
 * other property untouched.
 */
export function withRowBudget(
  db: D1Database,
  label: string,
  budget: number = REQUEST_ROW_BUDGET
): D1Database {
  const state: BudgetState = { rowsRead: 0, queries: 0, warned: false };

  const track = (meta: D1QueryMeta | undefined): void => {
    if (!meta || typeof meta.rows_read !== 'number') return;
    state.rowsRead += meta.rows_read;
    state.queries += 1;

    if (!state.warned && state.rowsRead > budget) {
      state.warned = true;
      console.warn(
        `[db-budget] ${label}: ${state.rowsRead} rows read across ` +
        `${state.queries} statement(s) — over the ${budget}-row request budget ` +
        `(free tier allows 5,000,000 rows/day for the whole account)`
      );
    }
  };

  const wrapStatement = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (typeof value !== 'function') return value;

        // bind() returns a new statement — keep it wrapped.
        if (prop === 'bind') {
          return (...args: unknown[]) =>
            wrapStatement(
              (value as (...a: unknown[]) => D1PreparedStatement).apply(target, args)
            );
        }

        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (!(out instanceof Promise)) return out;
          if (prop === 'all' || prop === 'run' || prop === 'raw') {
            return out.then((res) => {
              track((res as { meta?: D1QueryMeta } | undefined)?.meta);
              return res;
            });
          }
          return out;
        };
      },
    });

  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;

      if (prop === 'prepare' && typeof value === 'function') {
        return (...args: unknown[]) =>
          wrapStatement(
            (value as (...a: unknown[]) => D1PreparedStatement).apply(target, args)
          );
      }

      if (prop === 'batch' && typeof value === 'function') {
        return (...args: unknown[]) =>
          (value as (...a: unknown[]) => Promise<unknown>).apply(target, args).then((res) => {
            if (Array.isArray(res)) {
              for (const r of res) track((r as { meta?: D1QueryMeta } | undefined)?.meta);
            }
            return res;
          });
      }

      return value;
    },
  }) as D1Database;
}

// ─── Free-tier quota handling ────────────────────────────────────────────────

/** Matches both the row read and row write limit messages D1 returns. */
const D1_DAILY_LIMIT_PATTERN = /exceeded D1's free tier daily row (read|write) limit/i;

/** True when an error is the free-tier daily quota rejection (not a code bug). */
export function isD1QuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return D1_DAILY_LIMIT_PATTERN.test(message);
}

/** Seconds until the quota resets (00:00 UTC), floored at 60. */
export function secondsUntilQuotaReset(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  );
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}
