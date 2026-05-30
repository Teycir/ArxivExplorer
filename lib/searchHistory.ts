/**
 * lib/searchHistory.ts
 *
 * Client-side localStorage search history.
 * Stores the last HISTORY_CAP unique queries, most-recent first.
 * No TTL — history is cheap and users want it to persist.
 */

export const HISTORY_CAP = 20;
const LS_KEY = 'arxiv_search_history';

export interface HistoryEntry {
  query:   string;
  searchedAt: number; // unix ms
}

// ── I/O ───────────────────────────────────────────────────────────────────────

function read(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function write(entries: HistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Push a query to the front. Deduplicates (case-insensitive) and caps at HISTORY_CAP. */
export function pushSearch(query: string): HistoryEntry[] {
  const q = query.trim();
  if (!q) return read();
  const existing = read().filter(e => e.query.toLowerCase() !== q.toLowerCase());
  const updated  = [{ query: q, searchedAt: Date.now() }, ...existing].slice(0, HISTORY_CAP);
  write(updated);
  return updated;
}

export function getHistory(): HistoryEntry[] {
  return read();
}

export function removeEntry(query: string): HistoryEntry[] {
  const updated = read().filter(e => e.query !== query);
  write(updated);
  return updated;
}

export function clearHistory(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(LS_KEY);
}
