/**
 * lib/bookmarks.ts
 *
 * Client-side localStorage bookmark system for ArxivExplorer.
 *
 * Combines two auto-erase mechanisms:
 *   1. Count cap (SeekYou pattern): SOFT_CAP = 100 bookmarks.
 *      When saving a new paper beyond the cap, the oldest entry is pruned.
 *      A warning banner fires at WARN_THRESHOLD = 75.
 *   2. TTL expiry (Sanctum pattern): each bookmark expires after BOOKMARK_TTL_DAYS = 90.
 *      On every read, stale entries are purged silently.
 *      A warning is surfaced for bookmarks expiring within EXPIRY_WARN_DAYS = 7.
 */

export const SOFT_CAP          = 100;
export const WARN_THRESHOLD    = 75;
export const BOOKMARK_TTL_DAYS = 90;
export const EXPIRY_WARN_DAYS  = 7;

const LS_KEY = 'arxiv_bookmarks';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadStatus = 'unread' | 'reading' | 'done';

export interface Bookmark {
  id:         string;   // arXiv ID  e.g. "2301.07041"
  title:      string;
  authors:    string[];
  categories: string[];
  savedAt:    number;   // unix ms
  expiresAt:  number;   // unix ms  (savedAt + TTL)
  note?:      string;   // optional user annotation
  status:     ReadStatus;
  collection?: string;  // collection name, undefined = uncategorised
}

export interface BookmarkStore {
  bookmarks:  Bookmark[];
  /** How many items were pruned (count + TTL) the last time we loaded. */
  prunedCount: number;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function readRaw(): Bookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(bookmarks: Bookmark[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bookmarks));
    // BUG-09: 'storage' events only fire in *other* tabs.  Dispatch a custom
    // event so same-tab listeners (e.g. Navbar) can react immediately.
    window.dispatchEvent(new CustomEvent('arxiv:bookmarks-changed'));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

// ── Core functions (usable outside React) ────────────────────────────────────

/**
 * Load bookmarks, purge expired ones, and return result + prune count.
 * This is the single source of truth for reading.
 */
export function loadBookmarks(): BookmarkStore {
  const raw    = readRaw();
  const now    = Date.now();
  const fresh  = raw.filter(b => b.expiresAt > now);
  const pruned = raw.length - fresh.length;
  if (pruned > 0) writeRaw(fresh);
  return { bookmarks: fresh, prunedCount: pruned };
}

/** Save a paper as a bookmark. Enforces SOFT_CAP (oldest pruned if needed). */
export function addBookmark(
  paper: Pick<Bookmark, 'id' | 'title' | 'authors' | 'categories'>,
): { bookmarks: Bookmark[]; pruned: boolean } {
  const { bookmarks } = loadBookmarks();

  // Idempotent — already bookmarked
  if (bookmarks.some(b => b.id === paper.id)) {
    return { bookmarks, pruned: false };
  }

  const now: number = Date.now();
  const entry: Bookmark = {
    ...paper,
    savedAt:   now,
    expiresAt: now + BOOKMARK_TTL_DAYS * 86_400_000,
    status:    'unread',
  };

  let updated = [entry, ...bookmarks];
  let pruned  = false;

  // Enforce cap: drop oldest until we're back at SOFT_CAP
  if (updated.length > SOFT_CAP) {
    updated = updated.slice(0, SOFT_CAP);
    pruned  = true;
  }

  writeRaw(updated);
  return { bookmarks: updated, pruned };
}

/** Remove a single bookmark by arXiv ID. */
export function removeBookmark(id: string): Bookmark[] {
  const { bookmarks } = loadBookmarks();
  const updated = bookmarks.filter(b => b.id !== id);
  writeRaw(updated);
  return updated;
}

/** Update the note on a bookmark. */
export function updateNote(id: string, note: string): Bookmark[] {
  const { bookmarks } = loadBookmarks();
  const updated = bookmarks.map(b => {
    if (b.id !== id) return b;
    const trimmed = note.trim();
    if (!trimmed) {
      const { note: _, ...rest } = b;
      return rest;
    }
    return { ...b, note: trimmed };
  });
  writeRaw(updated);
  return updated;
}

/** Wipe everything. */
export function purgeAllBookmarks(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_KEY);
}

/** Returns true if the given arXiv ID is bookmarked. */
export function isBookmarked(id: string): boolean {
  const { bookmarks } = loadBookmarks();
  return bookmarks.some(b => b.id === id);
}

/** Days until a bookmark expires (may be negative if somehow still around). */
export function daysUntilExpiry(bookmark: Bookmark): number {
  return Math.ceil((bookmark.expiresAt - Date.now()) / 86_400_000);
}

/** Update the read status of a bookmark. */
export function updateStatus(id: string, status: ReadStatus): Bookmark[] {
  const { bookmarks } = loadBookmarks();
  const updated = bookmarks.map(b => b.id === id ? { ...b, status } : b);
  writeRaw(updated);
  return updated;
}

/** Assign or clear a collection on a bookmark. */
export function updateCollection(id: string, collection: string | undefined): Bookmark[] {
  const { bookmarks } = loadBookmarks();
  const updated = bookmarks.map(b => {
    if (b.id !== id) return b;
    if (!collection) {
      const { collection: _, ...rest } = b;
      return rest;
    }
    return { ...b, collection };
  });
  writeRaw(updated);
  return updated;
}

/** Return sorted unique collection names from all bookmarks. */
export function getCollections(): string[] {
  const { bookmarks } = loadBookmarks();
  const names = bookmarks
    .map(b => b.collection)
    .filter((c): c is string => Boolean(c));
  return [...new Set(names)].sort();
}
