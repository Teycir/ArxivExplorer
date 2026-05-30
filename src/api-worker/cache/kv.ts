/**
 * src/api-worker/cache/kv.ts
 * Lazy KV get/set helpers.
 *
 * Rule: KV is populated on first user access (lazy), NOT at ingestion time.
 * This keeps KV write volume below the free-tier 1k/day limit.
 *
 * Fire-and-forget writes: callers do NOT await put operations — the response
 * is returned immediately and the KV write races asynchronously.
 */

/**
 * Gets a typed value from KV. Returns null on miss; throws on KV errors
 * so callers can distinguish "not found" from "service error".
 */
export async function kvGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key, 'text');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`KV parse error for key "${key}": ${String(err)}`);
  }
}

/**
 * Writes a value to KV without awaiting (fire-and-forget).
 * The caller must pass `ctx.waitUntil` to ensure the write completes
 * after the response is returned.
 *
 * @param expirationTtl - TTL in seconds. Omit for permanent (no expiry).
 */
export function kvPutAsync(
  ctx: ExecutionContext,
  kv: KVNamespace,
  key: string,
  value: unknown,
  expirationTtl?: number
): void {
  const serialized = JSON.stringify(value);
  const options = expirationTtl != null ? { expirationTtl } : undefined;
  ctx.waitUntil(kv.put(key, serialized, options));
}

/**
 * Invalidates (deletes) a KV key. Used to bust the trending cache
 * after new papers are ingested.
 */
export async function kvDelete(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}
