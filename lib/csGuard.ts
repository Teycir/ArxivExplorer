/**
 * lib/csGuard.ts — DELETED
 *
 * The CS guard was a client-side UX check that blocked queries
 * not matching a CS keyword allowlist. It was removed because:
 *
 *   1. The DB only contains CS papers — any query that returns results
 *      is already in-scope by definition.
 *   2. The guard was never wired up to SearchBoxHome or SearchFilters,
 *      so it had zero effect on the UI.
 *   3. The allowlist required constant maintenance and still produced
 *      false negatives (legitimate CS queries blocked).
 *
 * If scope enforcement is ever needed, do it at the API/DB layer, not
 * in client-side JavaScript.
 *
 * This file is kept as a tombstone so git history explains the removal.
 * All exports have been removed — any import of this file will now
 * produce a TypeScript error, making stale references easy to find.
 */
