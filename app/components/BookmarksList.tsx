/**
 * app/components/BookmarksList.tsx
 *
 * Client component for the /bookmarks page.
 *
 * Features:
 *  - Loads from localStorage on mount, surfaces TTL-pruned count via toast
 *  - Threshold warning banner at WARN_THRESHOLD (75) bookmarks
 *  - Per-bookmark expiry warning (< EXPIRY_WARN_DAYS)
 *  - Optimistic single delete
 *  - Inline note editing (pencil → input → confirm/cancel)
 *  - Purge-all with confirm step
 *  - Progress bar showing fill vs SOFT_CAP
 *  - Status filter tabs (all / unread / reading / done) with per-tab counts
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
  purgeAllBookmarks,
  daysUntilExpiry,
  SOFT_CAP,
  WARN_THRESHOLD,
  EXPIRY_WARN_DAYS,
  type Bookmark as BM,
  type ReadStatus,
} from '@/lib/bookmarks';
import { formatAuthors } from '@/helper/format';

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

// ── Status toggle ─────────────────────────────────────────────────────────────

const STATUS_CYCLE: ReadStatus[] = ['unread', 'reading', 'done'];
const STATUS_LABEL: Record<ReadStatus, string> = {
  unread:  '○ unread',
  reading: '◑ reading',
  done:    '✓ done',
};
const STATUS_CLASS: Record<ReadStatus, string> = {
  unread:  'text-neon-red/30 border-neon-red/15',
  reading: 'text-amber-400/70 border-amber-500/30',
  done:    'text-green-400/70 border-green-500/30',
};

function StatusToggle({
  status,
  onChange,
}: {
  status: ReadStatus;
  onChange: (next: ReadStatus) => void;
}) {
  function cycle() {
    const idx  = STATUS_CYCLE.indexOf(status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]!;
    onChange(next);
  }
  return (
    <button
      onClick={cycle}
      title={`Status: ${status} — click to cycle`}
      className={[
        'inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-mono',
        'transition-colors duration-150 hover:opacity-80',
        STATUS_CLASS[status],
      ].join(' ')}
    >
      {STATUS_LABEL[status]}
    </button>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function BookmarkRow({
  bookmark,
  onDelete,
  onNote,
  onStatus,
}: {
  bookmark: BM;
  onDelete:  (id: string) => void;
  onNote:    (id: string, note: string) => void;
  onStatus:  (id: string, status: ReadStatus) => void;
}) {
  const [editing,  setEditing]  = useState(false);
  const [noteVal,  setNoteVal]  = useState(bookmark.note ?? '');
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDelete() {
    setDeleting(true);
    removeBookmark(bookmark.id);
    onDelete(bookmark.id);
  }

  function confirmNote() {
    setSaving(true);
    onNote(bookmark.id, noteVal.trim());
    setSaving(false);
    setEditing(false);
  }

  function cancelNote() {
    setNoteVal(bookmark.note ?? '');
    setEditing(false);
  }

  const savedDate = new Date(bookmark.savedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div className={`rounded-xl border border-neon-red/10 bg-dark-bg px-5 py-4
      transition-opacity duration-300 ${deleting ? 'opacity-40 pointer-events-none' : ''}`}>

      {/* Top row: title + expiry */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <Link
          href={`/paper/${encodeURIComponent(bookmark.id)}`}
          className="font-mono text-sm text-white/90 hover:text-neon-red transition-colors leading-snug flex-1 min-w-0"
        >
          {bookmark.title}
        </Link>
        <ExpiryPill bookmark={bookmark} />
      </div>

      {/* Authors + categories + status */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="flex items-center gap-1 text-[11px] text-neon-red/40 font-mono">
          <Users size={10} />
          {formatAuthors(bookmark.authors, 2)}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-neon-red/30 font-mono">
          <Tag size={10} />
          {bookmark.categories.slice(0, 2).join(', ')}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-neon-red/25 font-mono ml-auto">
          <Clock size={10} />
          saved {savedDate}
        </span>
        <StatusToggle
          status={bookmark.status}
          onChange={(next) => onStatus(bookmark.id, next)}
        />
      </div>

      {/* Note row */}
      <div className="flex items-center gap-2 min-h-[22px]">
        {editing ? (
          <>
            <input
              ref={inputRef}
              value={noteVal}
              onChange={e => setNoteVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmNote(); if (e.key === 'Escape') cancelNote(); }}
              maxLength={200}
              placeholder="Add a note…"
              autoFocus
              className="flex-1 bg-neutral-800 border border-neon-red/20 rounded px-2 py-0.5
                         text-xs font-mono text-white placeholder-neutral-600
                         focus:outline-none focus:border-neon-red/50"
            />
            <button onClick={confirmNote} disabled={saving}
              className="text-[10px] font-mono text-green-400 hover:text-green-300 disabled:opacity-50">
              {saving ? '…' : '✓'}
            </button>
            <button onClick={cancelNote}
              className="text-[10px] font-mono text-neutral-500 hover:text-white">
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-neutral-600 font-mono flex-1 truncate">
              {bookmark.note ?? <span className="italic text-neutral-700">no note</span>}
            </span>
            <button onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
              className="text-[10px] text-neutral-600 hover:text-neon-red font-mono transition-colors"
              title="Edit note">✎</button>
            <button onClick={handleDelete}
              className="text-[10px] text-neutral-600 hover:text-red-400 font-mono transition-colors"
              title="Remove bookmark">✕</button>
            <Link href={`/paper/${encodeURIComponent(bookmark.id)}`}
              className="text-[10px] text-neutral-600 hover:text-neon-red font-mono transition-colors"
              title="Open paper">→</Link>
          </>
        )}
      </div>
    </div>
  );
}

// ── Status filter tabs ────────────────────────────────────────────────────────

type FilterTab = 'all' | ReadStatus;

const FILTER_TABS: { key: FilterTab; label: string; icon: string }[] = [
  { key: 'all',     label: 'all',     icon: '≡'  },
  { key: 'unread',  label: 'unread',  icon: '○'  },
  { key: 'reading', label: 'reading', icon: '◑'  },
  { key: 'done',    label: 'done',    icon: '✓'  },
];

const FILTER_TAB_ACTIVE: Record<FilterTab, string> = {
  all:     'border-neon-red/50 text-neon-red bg-neon-red/10',
  unread:  'border-neon-red/50 text-neon-red bg-neon-red/10',
  reading: 'border-amber-500/50 text-amber-400 bg-amber-500/10',
  done:    'border-green-500/50 text-green-400 bg-green-500/10',
};

function StatusFilterTabs({
  active,
  counts,
  onSelect,
}: {
  active: FilterTab;
  counts: Record<FilterTab, number>;
  onSelect: (tab: FilterTab) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {FILTER_TABS.map(({ key, label, icon }) => {
        const isActive = active === key;
        const count    = counts[key];
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={[
              'inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-mono',
              'transition-colors duration-150',
              isActive
                ? FILTER_TAB_ACTIVE[key]
                : 'border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300',
            ].join(' ')}
          >
            <span>{icon}</span>
            <span>{label}</span>
            {count > 0 && (
              <span className={`rounded px-1 text-[9px] ${
                isActive ? 'bg-white/10' : 'bg-neutral-800'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main list ─────────────────────────────────────────────────────────────────

export function BookmarksList() {
  const [bookmarks,   setBookmarks]   = useState<BM[]>([]);
  const [toast,       setToast]       = useState<string | null>(null);
  const [loaded,      setLoaded]      = useState(false);
  const [activeTab,   setActiveTab]   = useState<FilterTab>('all');

  useEffect(() => {
    const { bookmarks: bms, prunedCount } = loadBookmarks();
    setBookmarks(bms);
    setLoaded(true);
    if (prunedCount > 0) {
      setToast(`${prunedCount} expired bookmark${prunedCount > 1 ? 's' : ''} were auto-removed.`);
    }
  }, []);

  function handleDelete(id: string) {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  }

  function handleNote(id: string, note: string) {
    const updated = updateNote(id, note);
    setBookmarks(updated);
  }

  function handleStatus(id: string, status: ReadStatus) {
    const updated = updateStatus(id, status);
    setBookmarks(updated);
  }

  function handlePurge() {
    purgeAllBookmarks();
    setBookmarks([]);
  }

  // Counts per tab (memoised so they don't flicker on status changes)
  const counts = useMemo<Record<FilterTab, number>>(() => ({
    all:     bookmarks.length,
    unread:  bookmarks.filter(b => b.status === 'unread').length,
    reading: bookmarks.filter(b => b.status === 'reading').length,
    done:    bookmarks.filter(b => b.status === 'done').length,
  }), [bookmarks]);

  // Filtered view
  const visible = useMemo(
    () => activeTab === 'all' ? bookmarks : bookmarks.filter(b => b.status === activeTab),
    [bookmarks, activeTab],
  );

  const nearingCap = bookmarks.length >= WARN_THRESHOLD;

  if (!loaded) {
    return (
      <div className="rounded-xl border border-neon-red/10 bg-dark-bg px-5 py-12 text-center">
        <p className="text-sm text-neon-red/30 font-mono animate-pulse">Loading…</p>
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className="rounded-xl border border-neon-red/10 bg-dark-bg px-5 py-16 text-center space-y-3">
        <Bookmark size={28} className="mx-auto text-neon-red/20" />
        <p className="text-sm text-neutral-500 font-mono">No bookmarks yet.</p>
        <p className="text-xs text-neutral-700 font-mono">
          Hit <span className="text-neon-red/40">☆ save</span> on any paper page.
        </p>
      </div>
    );
  }

  return (
    <>
      {nearingCap && <ThresholdBanner count={bookmarks.length} />}

      {/* Toolbar: count + filter tabs + purge */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-neutral-600 font-mono flex items-center gap-1.5 shrink-0">
          <FileText size={11} />
          {bookmarks.length} {bookmarks.length === 1 ? 'paper' : 'papers'}
          {nearingCap && (
            <span className={bookmarks.length >= SOFT_CAP ? 'text-red-400' : 'text-amber-500'}>
              {' '}/ {SOFT_CAP} cap
            </span>
          )}
        </span>

        <StatusFilterTabs
          active={activeTab}
          counts={counts}
          onSelect={setActiveTab}
        />

        <span className="ml-auto">
          <PurgeAllButton onPurge={handlePurge} />
        </span>
      </div>

      {/* Paper list */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-neon-red/10 bg-dark-bg px-5 py-10 text-center">
          <p className="text-sm text-neutral-600 font-mono">
            No <span className="text-neon-red/40">{activeTab}</span> papers.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(b => (
            <BookmarkRow
              key={b.id}
              bookmark={b}
              onDelete={handleDelete}
              onNote={handleNote}
              onStatus={handleStatus}
            />
          ))}
        </div>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
