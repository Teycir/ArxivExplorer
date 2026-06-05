// app/reading-path/page.tsx
// Find shortest reading path between two papers — with UX improvements:
// live paper lookup, title previews, recent suggestions, swap button

'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Navbar } from '../components/Navbar';
import { Card } from '../components/Card';
import {
  MapPin, ArrowRight, Search, Loader2, BookOpen,
  ArrowLeftRight, X, CheckCircle2, Clock, Shuffle,
} from 'lucide-react';
import Link from 'next/link';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PathNode {
  id: string;
  title: string;
  tldr: string;
}

interface PaperPreview {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
}

interface PaperInputState {
  id: string;
  preview: PaperPreview | null;
  loading: boolean;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local-storage helpers for recent IDs
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_KEY = 'arxiv-reading-path-recent';
const MAX_RECENT = 6;

function loadRecent(): PaperPreview[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch (err) {
    console.error('[loadRecent] Error loading recent papers:', err);
    return [];
  }
}

function saveRecent(paper: PaperPreview) {
  try {
    const list = loadRecent().filter((p) => p.id !== paper.id);
    list.unshift(paper);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch (err) {
    console.error('[saveRecent] Error saving recent paper:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Known-pairs for "try an example" quick-fill
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLE_PAIRS: Array<{ from: string; to: string; label: string }> = [
  { from: '1706.03762', to: '2302.13971', label: 'Attention → LLaMA' },
  { from: '1512.03385', to: '2010.11929', label: 'ResNet → ViT' },
  { from: '1406.2661',  to: '2006.11239', label: 'GAN → DDPM' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Paper-ID input with live preview
// ─────────────────────────────────────────────────────────────────────────────

function PaperInput({
  label,
  state,
  onChange,
  onClear,
  recentPapers,
  onSelectRecent,
  placeholder,
}: {
  label: string;
  state: PaperInputState;
  onChange: (val: string) => void;
  onClear: () => void;
  recentPapers: PaperPreview[];
  onSelectRecent: (p: PaperPreview) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const showDropdown = focused && !state.preview && recentPapers.length > 0 && !state.id;

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-xs font-mono text-neon-red/50 mb-2 uppercase tracking-wider">
        {label}
      </label>

      {/* Input row */}
      <div className={`relative flex items-center rounded-lg border transition-all duration-200
        ${state.preview
          ? 'border-neon-red/50 bg-neon-red/5'
          : state.error
          ? 'border-amber-400/40 bg-amber-400/5'
          : 'border-neon-red/20 bg-black/30 focus-within:border-neon-red/50'
        }`}>
        <input
          ref={inputRef}
          type="text"
          value={state.id}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={placeholder ?? 'e.g., 1706.03762'}
          className="flex-1 px-3 py-2.5 bg-transparent text-white/90 text-sm font-mono
            placeholder:text-white/20 focus:outline-none"
        />

        {/* Status indicator */}
        <div className="pr-3 flex items-center gap-1.5">
          {state.loading && (
            <Loader2 size={14} className="text-neon-red/50 animate-spin" />
          )}
          {state.preview && !state.loading && (
            <CheckCircle2 size={14} className="text-neon-red/70" />
          )}
          {state.id && (
            <button
              onClick={onClear}
              className="text-white/30 hover:text-white/60 transition-colors"
              tabIndex={-1}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Paper preview badge */}
      {state.preview && (
        <div className="mt-2 px-3 py-2 rounded-md bg-neon-red/8 border border-neon-red/20
          flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <BookOpen size={12} className="text-neon-red/50 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-mono text-white/80 leading-snug line-clamp-2">
              {state.preview.title}
            </p>
            {state.preview.authors && (
              <p className="text-[10px] text-white/35 font-mono mt-0.5">
                {state.preview.authors.slice(0, 2).join(', ')}
                {state.preview.authors.length > 2 ? ' et al.' : ''}
                {state.preview.year ? ` · ${state.preview.year}` : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {state.error && !state.loading && (
        <p className="mt-1.5 text-[11px] text-amber-400/60 font-mono">{state.error}</p>
      )}

      {/* Recent dropdown */}
      {showDropdown && (
        <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-neon-red/20
          bg-[#0a0a0a] shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 py-2 border-b border-neon-red/10 flex items-center gap-1.5">
            <Clock size={11} className="text-neon-red/40" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-neon-red/40">
              Recent
            </span>
          </div>
          {recentPapers.map((p) => (
            <button
              key={p.id}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus
                onSelectRecent(p);
                setFocused(false);
              }}
              className="w-full px-3 py-2.5 text-left hover:bg-neon-red/8 transition-colors
                border-b border-neon-red/8 last:border-0"
            >
              <p className="text-[11px] font-mono text-neon-red/60 mb-0.5">{p.id}</p>
              <p className="text-xs font-mono text-white/70 line-clamp-1">{p.title}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_API = 'https://arxiv-api.arxivexplorer.workers.dev';
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

function emptyState(): PaperInputState {
  return { id: '', preview: null, loading: false, error: null };
}

export default function ReadingPathPage() {
  const searchParams = useSearchParams();

  const [from, setFrom] = useState<PaperInputState>(emptyState);
  const [to, setTo]     = useState<PaperInputState>(emptyState);

  const [loading, setLoading] = useState(false);
  const [path,    setPath]    = useState<PathNode[] | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  const [recentPapers, setRecentPapers] = useState<PaperPreview[]>([]);

  // Debounce timers
  const fromTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial query params + recent list
  useEffect(() => {
    setRecentPapers(loadRecent());
    const f = searchParams.get('from');
    const t = searchParams.get('to');
    if (f) applyId('from', f, true);
    if (t) applyId('to', t, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch paper preview ────────────────────────────────────────────────────
  // Must call the public API URL directly — `/api/paper/:id` goes through
  // Next.js SSR / Cloudflare service binding, not reachable from the browser.
  // The response is a flat PaperWithSummary: { id, title, authors: string[], publishedAt, … }

  async function fetchPreview(id: string): Promise<PaperPreview | null> {
    try {
      const res = await fetch(
        `${PUBLIC_API}/api/paper/${encodeURIComponent(id.trim())}`
      );
      if (!res.ok) return null;
      const p: any = await res.json();
      if (!p?.title) return null;
      return {
        id: p.id ?? id,
        title: p.title,
        authors: Array.isArray(p.authors) ? p.authors : [],
        year: p.publishedAt ? new Date(p.publishedAt).getFullYear() : undefined,
      };
    } catch {
      return null;
    }
  }

  // ── Apply an ID to a field (with debounce for typing) ─────────────────────

  function applyId(field: 'from' | 'to', rawId: string, immediate = false) {
    const setter = field === 'from' ? setFrom : setTo;
    const timer  = field === 'from' ? fromTimer : toTimer;

    const id = rawId.trim();

    // Immediate clear
    if (!id) {
      setter(emptyState());
      return;
    }

    // Update the visible text immediately; clear any old preview/error
    setter((prev) => ({ ...prev, id: rawId, preview: null, error: null }));

    if (timer.current) clearTimeout(timer.current);

    const delay = immediate ? 0 : ARXIV_ID_RE.test(id) ? 400 : 900;

    // Capture `id` in closure — `rawId` won't change but be explicit
    const capturedId = id;

    timer.current = setTimeout(async () => {
      // After the debounce fires, bail out immediately if the format is wrong —
      // don't set loading or show any error for partial/invalid input
      if (!ARXIV_ID_RE.test(capturedId)) return;

      setter((prev) => {
        // If the user has already changed the field to something else, skip
        if (prev.id.trim() !== capturedId) return prev;
        return { ...prev, loading: true, error: null };
      });

      const preview = await fetchPreview(capturedId);

      setter((prev) => {
        // Guard again: discard result if the field moved on while we were fetching
        if (prev.id.trim() !== capturedId) return prev;
        return {
          ...prev,
          loading: false,
          preview,
          error: preview ? null : 'Paper not found',
        };
      });

      if (preview) {
        saveRecent(preview);
        setRecentPapers(loadRecent());
      }
    }, delay);
  }

  // ── Swap inputs ───────────────────────────────────────────────────────────

  function swap() {
    // Cancel any in-flight debounce timers before swapping state
    if (fromTimer.current) { clearTimeout(fromTimer.current); fromTimer.current = null; }
    if (toTimer.current)   { clearTimeout(toTimer.current);   toTimer.current   = null; }
    setFrom(to);
    setTo(from);
    setPath(null);
    setPathError(null);
  }

  // ── Quick-fill example ────────────────────────────────────────────────────

  function loadExample(pair: typeof EXAMPLE_PAIRS[0]) {
    applyId('from', pair.from, true);
    applyId('to',   pair.to,   true);
    setPath(null);
    setPathError(null);
  }

  // ── Find path ─────────────────────────────────────────────────────────────

  async function findPath() {
    const f = from.id.trim();
    const t = to.id.trim();
    if (!f || !t) {
      setPathError('Please enter both paper IDs');
      return;
    }
    if (f === t) {
      setPathError('Start and end papers must be different');
      return;
    }

    setLoading(true);
    setPathError(null);
    setPath(null);

    try {
      const res  = await fetch(
        `${PUBLIC_API}/api/reading-path?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`
      );
      const data: { path?: PathNode[]; error?: string } = await res.json();
      if (!res.ok) {
        setPathError(data.error ?? 'Failed to find path');
        return;
      }
      setPath(data.path ?? null);
      // persist both papers to recent
      if (from.preview) { saveRecent(from.preview); }
      if (to.preview)   { saveRecent(to.preview); }
      setRecentPapers(loadRecent());
    } catch (err) {
      console.error('[findPath] Error finding reading path:', err);
      setPathError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  const canSearch = from.id.trim() && to.id.trim() && !loading;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto w-full px-4 py-8 flex-1">

        {/* Header */}
        <div className="mb-7">
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={20} className="text-neon-red" />
            <h1 className="text-2xl font-mono font-bold text-white">Reading Path</h1>
          </div>
          <p className="text-sm text-white/50 font-mono">
            Find the shortest path between two papers using prerequisites and related work
          </p>
        </div>

        {/* Input card */}
        <Card>
          <div className="space-y-4">

            {/* FROM */}
            <PaperInput
              label="From Paper (arXiv ID)"
              state={from}
              onChange={(v) => applyId('from', v)}
              onClear={() => { setFrom(emptyState()); setPath(null); setPathError(null); }}
              recentPapers={recentPapers}
              onSelectRecent={(p) => applyId('from', p.id, true)}
              placeholder="e.g., 1706.03762"
            />

            {/* Swap button */}
            <div className="flex items-center justify-center">
              <button
                onClick={swap}
                title="Swap papers"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-neon-red/40
                  hover:text-neon-red/70 hover:bg-neon-red/8 border border-transparent
                  hover:border-neon-red/20 transition-all text-xs font-mono"
              >
                <ArrowLeftRight size={13} />
                swap
              </button>
            </div>

            {/* TO */}
            <PaperInput
              label="To Paper (arXiv ID)"
              state={to}
              onChange={(v) => applyId('to', v)}
              onClear={() => { setTo(emptyState()); setPath(null); setPathError(null); }}
              recentPapers={recentPapers}
              onSelectRecent={(p) => applyId('to', p.id, true)}
              placeholder="e.g., 2302.13971"
            />

            {/* Find button */}
            <button
              onClick={findPath}
              disabled={!canSearch}
              className="w-full flex items-center justify-center gap-2 px-4 py-3
                bg-neon-red/10 border border-neon-red/30 rounded-lg
                text-neon-red font-mono font-bold uppercase text-sm
                hover:bg-neon-red/20 hover:border-neon-red/50 transition-all
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Finding path…
                </>
              ) : (
                <>
                  <Search size={16} />
                  Find reading path
                </>
              )}
            </button>

            {/* Example pairs */}
            <div className="pt-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/25 mb-2">
                Try an example
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PAIRS.map((pair) => (
                  <button
                    key={pair.label}
                    onClick={() => loadExample(pair)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono
                      border border-neon-red/15 text-neon-red/50 hover:border-neon-red/35
                      hover:text-neon-red/70 hover:bg-neon-red/5 transition-all"
                  >
                    <Shuffle size={10} />
                    {pair.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Error */}
        {pathError && (
          <Card>
            <div className="flex items-start gap-2 text-amber-400/70">
              <span className="text-xl">⚠</span>
              <div>
                <p className="font-mono font-bold text-sm mb-1">No path found</p>
                <p className="text-xs text-white/50">{pathError}</p>
                <p className="text-xs text-white/35 mt-2">
                  Try papers in the same research area, or check that both IDs are valid.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Result path */}
        {path && path.length > 0 && (
          <Card>
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-neon-red/15">
              <div className="flex items-center gap-2">
                <BookOpen size={14} className="text-neon-red/60" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/60">
                  Reading Path · {path.length} paper{path.length !== 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-[10px] font-mono text-white/30">
                {path.length <= 2 ? 'Direct link' : path.length <= 4 ? 'Short path' : 'Long path'}
              </span>
            </div>

            <div className="space-y-3">
              {path.map((node, i) => (
                <div key={node.id}>
                  <Link href={`/paper/${node.id}`}>
                    <div className="p-4 rounded-lg border border-neon-red/15 bg-black/20
                      hover:border-neon-red/40 hover:bg-black/30 transition-all cursor-pointer group">
                      <div className="flex items-start gap-3 mb-2">
                        <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center
                          text-xs font-mono font-bold transition-colors
                          ${i === 0
                            ? 'bg-neon-red/30 border border-neon-red/60 text-neon-red'
                            : i === path.length - 1
                            ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                            : 'bg-neon-red/15 border border-neon-red/35 text-neon-red/80'
                          }`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="text-sm font-mono font-bold text-white/90 leading-snug
                              group-hover:text-white transition-colors">
                              {node.title}
                            </h3>
                          </div>
                          <p className="text-[10px] text-neon-red/40 font-mono">{node.id}</p>
                        </div>
                        {i === 0 && (
                          <span className="flex-shrink-0 text-[9px] font-mono uppercase tracking-wider
                            px-1.5 py-0.5 rounded bg-neon-red/15 border border-neon-red/25 text-neon-red/60">
                            Start
                          </span>
                        )}
                        {i === path.length - 1 && (
                          <span className="flex-shrink-0 text-[9px] font-mono uppercase tracking-wider
                            px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/25 text-green-400/70">
                            Goal
                          </span>
                        )}
                      </div>
                      {node.tldr && node.tldr !== 'No summary available' && (
                        <p className="text-xs text-white/55 leading-relaxed pl-9">
                          {node.tldr}
                        </p>
                      )}
                    </div>
                  </Link>

                  {i < path.length - 1 && (
                    <div className="flex items-center justify-center py-1.5 gap-1">
                      <div className="h-px w-8 bg-neon-red/15" />
                      <ArrowRight size={13} className="text-neon-red/25" />
                      <div className="h-px w-8 bg-neon-red/15" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-neon-red/10">
              <p className="text-xs text-white/35 font-mono">
                💡 Start with paper&nbsp;1 and work through the list to build the background
                needed for paper&nbsp;{path.length}.
              </p>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
