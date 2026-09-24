/**
 * tests/helpers/durable-env.ts
 *
 * One fake Env for every "serve from the durable twin when D1 is exhausted" test:
 * an in-memory KV that records every put, and a D1 whose behaviour is chosen per
 * test and whose reads are counted. Rows are routed by a substring of the SQL so a
 * route that issues several queries (stats, sitemap) gets the right rows for each.
 */

export type DbMode = 'ok' | 'quota' | 'boom';

/** Must match the production classifier (db-budget.ts D1_DAILY_LIMIT_PATTERN). */
export const QUOTA_MESSAGE = "D1_ERROR: Exceeded D1's free tier daily row read limit";

export interface Route {
  /** Substring of the SQL this route answers, e.g. 'FROM counters'. */
  match: string;
  /** Rows returned by `.all()` / the single row returned by `.first()`. */
  rows: unknown[];
}

export function makeEnv(opts: {
  db: DbMode;
  routes?: Route[];
  kv?: Record<string, unknown>;
}) {
  const store = new Map<string, string>(
    Object.entries(opts.kv ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  );
  const puts: Array<{ key: string; ttl?: number | undefined }> = [];
  const CACHE = {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string, o?: { expirationTtl?: number }) {
      puts.push({ key: k, ttl: o?.expirationTtl });
      store.set(k, v);
    },
    async delete(k: string) { store.delete(k); },
  };

  let d1Calls = 0;
  const gate = () => {
    d1Calls++;
    if (opts.db === 'quota') throw new Error(QUOTA_MESSAGE);
    if (opts.db === 'boom') throw new Error('D1_ERROR: something unrelated');
  };
  const rowsFor = (sql: string) => (opts.routes ?? []).find(r => sql.includes(r.match))?.rows ?? [];

  const DB = {
    prepare(sql: string) {
      const s: any = {
        bind() { return s; },
        async all() { gate(); return { results: rowsFor(sql), meta: { rows_read: 1 } }; },
        async first() { gate(); return rowsFor(sql)[0] ?? null; },
      };
      return s;
    },
  };

  const env = {
    CACHE, DB,
    RATE_LIMITER: { async limit() { return { success: true }; } },
    ALLOWED_ORIGIN: 'https://arxivexplorer.arxivexplorer.workers.dev',
  } as any;

  return { env, store, puts, d1: () => d1Calls };
}

export const makeCtx = () => {
  const pending: Promise<unknown>[] = [];
  return {
    c: { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as any,
    settle: () => Promise.all(pending),
  };
};

/** A unique client IP per call so the rate limiter never interferes with the test. */
let n = 0;
export const nextIp = () => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n++ & 255}`;

export const bodyOf = async (r: Response) => (await r.clone().json()) as any;
