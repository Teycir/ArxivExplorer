/**
 * app/components/BookmarksList.tsx
 *
 * Client component for the /bookmarks page.
 *
 * POLICY: On load, every bookmark ID is validated against the API.
 * Any bookmark whose paper no longer exists in the DB is silently removed
 * from localStorage and never shown as a clickable link.
 */
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Bookmark, FileText, Users, Tag, Clock, AlertTriangle } from 'lucide-react';
import {
  loadBookmarks,
  removeBookmark,
  updateNote,
  updateStatus,
  updateCollection,
  purgeAllBookmarks,
  daysUntilExpiry,
  SOFT_CAP,
  WARN_THRESHOLD,
  EXPIRY_WARN_DAYS,
  type Bookmark as BM,
  type ReadStatus,
} from '@/lib/bookmarks';
import { getPaper } from '@/helper/api';
import { formatAuthors } from '@/helper/format';
import { CollectionManager, CollectionExport } from './CollectionManager';

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                    flex items-center gap-3 rounded-lg border border-amber-700/50
                    bg-dark-bg px-4 py-3 shadow-xl text-sm font-mono text-amber-300
                    animate-in fade-in slide-in-from-bottom-2 duration-200">
      <AlertTriangle size={14} />
      <span>{message}</span>
      <button onClick={onDismiss} className="text-neutral-500 hover:text-white transition-colors ml-2">✕</button>
    </div>
  );
}

// ── Expiry pill ───────────────────────────────────────────────────────────────

function ExpiryPill({ bookmark }: { bookmark: BM }) {
  const days = daysUntilExpiry(bookmark);
  if (days > EXPIRY_WARN_DAYS) return null;

  const color = days <= 1
    ? 'text-red-400 border-red-800/60 bg-red-500/10'
    : 'text-amber-400 border-amber-800/60 bg-amber-500/10';

  const label = days <= 0
    ? 'expires today'
    : days === 1
      ? 'expires tomorrow'
      : `expires in ${days}d`;

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${color}`}>
      <Clock size={9} />
      {label}
    </span>
  );
}

// ── Threshold banner ──────────────────────────────────────────────────────────

function ThresholdBanner({ count }: { count: number }) {
  const pct   = Math.round((count / SOFT_CAP) * 100);
  const atCap = count >= SOFT_CAP;

  return (
    <div className={`rounded-lg border px-4 py-3 text-xs font-mono space-y-2
      ${atCap
        ? 'border-red-800/50 bg-red-950/20 text-red-300'
        : 'border-amber-800/40 bg-amber-950/15 text-amber-400'}`}>
      <div className="flex items-center gap-2">
        <AlertTriangle size={12} className="shrink-0" />
        <span>
          {atCap
            ? `Cap reached (${count}/${SOFT_CAP}) — oldest bookmarks are auto-pruned when you save new ones.`
            : `${count}/${SOFT_CAP} bookmarks saved (${pct}%) — oldest will be pruned after ${SOFT_CAP}.`}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-neutral-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${atCap ? 'bg-red-500' : 'bg-amber-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── Purge-all button ──────────────────────────────────────────────────────────

function PurgeAllButton({ onPurge }: { onPurge: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'purging'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function request() {
    setPhase('confirm');
    timerRef.current = setTimeout(() => setPhase('idle'), 4000);
  }
  function cancel() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('idle');
  }
  function confirm() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('purging');
    onPurge();
    setPhase('idle');
  }

  if (phase === 'confirm') {
    return (
      <div className="flex items-center gap-2 animate-in fade-in duration-150">
        <span className="text-xs font-mono text-red-400">Delete all?</span>
        <button onClick={confirm}
          className="text-xs font-mono text-red-400 hover:text-red-300 border border-red-800/60 rounded px-2 py-0.5 transition-colors">
          yes, purge
        </button>
        <button onClick={cancel}
          className="text-xs font-mono text-neutral-500 hover:text-white transition-colors">
          cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={request}
      disabled={phase === 'purging'}
      className="text-xs font-mono text-neutral-600 hover:text-red-400
                 border border-neutral-800 hover:border-red-800/50
                 rounded px-3 py-1 transition-colors disabled:opacity-40"
    >
      {phase === 'purging' ? 'purging…' : 'purge all'}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BookmarksList() {
  const [bookmarks, setBookmarks] = useState<BM[]>([]);
  const [validIds,  setValidIds]  = useState<Set<string> | null>(null); // null = validating
  const [toast,     setToast]     = useState<string | null>(null);
  const [filter,    setFilter]    = useState<ReadStatus | 'all'>('all');
  const [collection, setCollection] = useState<string | 'all'>('all');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText,    setNoteText]    = useState('');

  // ── 1. Load from localStorage ─────────────────────────────────────────────
  useEffect(() => {
    const { bookmarks: bms, prunedCount } = loadBookmarks();
    setBookmarks(bms);
    if (prunedCount > 0) {
      setToast(`${prunedCount} expired bookmark${prunedCount > 1 ? 's' : ''} removed`);
    }

    // ── 2. Validate each ID against the DB ──────────────────────────────────
    // Fire-and-forget: for each bookmark try GET /api/paper/:id.
    // Any that 404 (or throw) are silently removed from localStorage + state.
    if (bms.length === 0) {
      setValidIds(new Set());
      return;
    }

    (async () => {
      const results = await Promise.allSettled(
        bms.map(b => getPaper(b.id).then(() => b.id))
      );

      const alive = new Set<string>();
      const dead:  string[] = [];

      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') alive.add(r.value);
        else {
          const id = bms[idx]?.id;
          if (id) dead.push(id);
        }
      });

      // Remove dead IDs from localStorage
      dead.forEach(id => removeBookmark(id));

      setValidIds(alive);

      if (dead.length > 0) {
        setBookmarks(prev => prev.filter(b => alive.has(b.id)));
        setToast(
          `${dead.length} bookmark${dead.length > 1 ? 's' : ''} removed — ` +
          `paper${dead.length > 1 ? 's' : ''} no longer in DB`
        );
      }
    })();
  }, []);

  // ── Listen for same-tab changes (e.g. un-bookmark from paper page) ─────────
  useEffect(() => {
    function sync() {
      const { bookmarks: bms } = loadBookmarks();
      setBookmarks(bms);
    }
    window.addEventListener('arxiv:bookmarks-changed', sync);
    return () => window.removeEventListener('arxiv:bookmarks-changed', sync);
  }, []);

  const collections = useMemo(
    () => [...new Set(bookmarks.map(b => b.collection).filter(Boolean) as string[])].sort(),
    [bookmarks]
  );

  const visible = useMemo(() => {
    let bms = bookmarks;
    if (filter     !== 'all') bms = bms.filter(b => b.status    === filter);
    if (collection !== 'all') bms = bms.filter(b => b.collection === collection);
    return bms;
  }, [bookmarks, filter, collection]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleRemove(id: string) {
    setBookmarks(removeBookmark(id));
  }
  function handleStatus(id: string, status: ReadStatus) {
    setBookmarks(updateStatus(id, status));
  }
  function handleCollection(id: string, col: string | undefined) {
    setBookmarks(updateCollection(id, col));
  }
  function handleNoteOpen(b: BM) {
    setEditingNote(b.id);
    setNoteText(b.note ?? '');
  }
  function handleNoteSave(id: string) {
    setBookmarks(updateNote(id, noteText));
    setEditingNote(null);
  }
  function handlePurge() {
    purgeAllBookmarks();
    setBookmarks([]);
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (validIds !== null && bookmarks.length === 0) {
    return (
      <div className="text-center py-16 font-mono text-neutral-600 text-sm space-y-2">
        <Bookmark size={32} className="mx-auto opacity-20" />
        <p>No bookmarks yet.</p>
        <p className="text-xs text-neutral-700">
          Hit the bookmark icon on any paper to save it here.
        </p>
      </div>
    );
  }

  const isValidating = validIds === null;

  return (
    <>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* ── Controls row ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* status filter */}
        {(['all', 'unread', 'reading', 'done'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors
              ${filter === s
                ? 'border-neon-red/50 text-neon-red bg-neon-red/10'
                : 'border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600'}`}>
            {s}
          </button>
        ))}

        {/* collection filter */}
        {collections.length > 0 && (
          <select
            value={collection}
            onChange={e => setCollection(e.target.value)}
            className="text-xs font-mono bg-dark-bg border border-neutral-800 rounded px-2 py-0.5
                       text-neutral-400 hover:border-neutral-600 transition-colors cursor-pointer">
            <option value="all">all collections</option>
            {collections.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <CollectionExport bookmarks={bookmarks} />
          <PurgeAllButton onPurge={handlePurge} />
        </div>
      </div>

      {/* ── Threshold banner ─────────────────────────────────────────────── */}
      {bookmarks.length >= WARN_THRESHOLD && (
        <ThresholdBanner count={bookmarks.length} />
      )}

      {/* ── Validating spinner ───────────────────────────────────────────── */}
      {isValidating && (
        <p className="text-xs font-mono text-neutral-600 animate-pulse mb-3">
          Verifying bookmarks against DB…
        </p>
      )}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {visible.map(b => (
          <div key={b.id}
            className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2
                       hover:border-neutral-700 transition-colors">

            {/* Title row */}
            <div className="flex items-start gap-2">
              <Link href={`/paper/${b.id}`}
                className="font-mono text-sm text-white/90 hover:text-neon-red transition-colors leading-snug flex-1">
                {b.title}
              </Link>
              <button onClick={() => handleRemove(b.id)}
                className="text-neutral-700 hover:text-red-400 transition-colors shrink-0 mt-0.5">
                <Bookmark size={14} fill="currentColor" />
              </button>
            </div>

            {/* Authors */}
            {b.authors.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-neutral-500 font-mono">
                <Users size={10} />
                {formatAuthors(b.authors)}
              </p>
            )}

            {/* Categories */}
            {b.categories.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-neutral-600 font-mono">
                <Tag size={10} />
                {b.categories.slice(0, 4).join(', ')}
              </p>
            )}

            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {/* read status */}
              <select
                value={b.status}
                onChange={e => handleStatus(b.id, e.target.value as ReadStatus)}
                className="text-[11px] font-mono bg-neutral-900 border border-neutral-800 rounded
                           px-1.5 py-0.5 text-neutral-400 cursor-pointer hover:border-neutral-600 transition-colors">
                <option value="unread">unread</option>
                <option value="reading">reading</option>
                <option value="done">done</option>
              </select>

              {/* collection manager */}
              <CollectionManager
                bookmarkId={b.id}
                currentCollection={b.collection}
                allCollections={collections}
                onUpdate={col => handleCollection(b.id, col)}
              />

              {/* note */}
              <button onClick={() => handleNoteOpen(b)}
                className="text-[11px] font-mono text-neutral-600 hover:text-white
                           border border-neutral-800 hover:border-neutral-600 rounded px-1.5 py-0.5 transition-colors">
                <FileText size={10} className="inline mr-1" />
                {b.note ? 'edit note' : 'add note'}
              </button>

              {/* expiry pill */}
              <ExpiryPill bookmark={b} />

              {/* arxiv ID */}
              <span className="text-[10px] font-mono text-neutral-700 ml-auto">{b.id}</span>
            </div>

            {/* Inline note displayed */}
            {b.note && editingNote !== b.id && (
              <p className="text-xs font-mono text-neutral-500 border-l-2 border-neutral-800 pl-2 mt-1 italic">
                {b.note}
              </p>
            )}

            {/* Note editor */}
            {editingNote === b.id && (
              <div className="flex gap-2 items-end mt-1">
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  rows={2}
                  placeholder="Your note…"
                  className="flex-1 text-xs font-mono bg-neutral-900 border border-neutral-700
                             rounded px-2 py-1 text-white/80 placeholder-neutral-700
                             focus:outline-none focus:border-neon-red/50 resize-none"
                />
                <div className="flex flex-col gap-1">
                  <button onClick={() => handleNoteSave(b.id)}
                    className="text-[11px] font-mono text-green-400 border border-green-900/60
                               rounded px-2 py-0.5 hover:bg-green-950/30 transition-colors">
                    save
                  </button>
                  <button onClick={() => setEditingNote(null)}
                    className="text-[11px] font-mono text-neutral-500 border border-neutral-800
                               rounded px-2 py-0.5 hover:text-white transition-colors">
                    cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {visible.length === 0 && bookmarks.length > 0 && (
        <p className="text-center py-8 text-xs font-mono text-neutral-600">
          No bookmarks match the current filter.
        </p>
      )}
    </>
  );
}
