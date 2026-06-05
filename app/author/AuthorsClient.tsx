'use client';
/**
 * app/author/AuthorsClient.tsx
 * Interactive authors leaderboard.
 * Receives the full author list SSR; all filtering/sorting happens client-side.
 */

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { AuthorSummary } from '@/helper/api';
import {
  Search, X, ChevronUp, ChevronDown,
  BookOpen, Code, ChevronsUpDown,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type SortKey = 'paperCount' | 'totalCitations' | 'totalInfluentialCites' | 'codeCount' | 'latestPaper';

interface Props {
  initialAuthors: AuthorSummary[];
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  'cs.AI': 'AI',  'cs.LG': 'ML',  'cs.CL': 'NLP', 'cs.CV': 'Vision',
  'cs.CR': 'Sec', 'cs.DC': 'Sys', 'cs.DS': 'Algo','cs.SE': 'SE',
  'cs.RO': 'Robo','cs.DB': 'DB',  'cs.PL': 'PL',  'cs.IT': 'IT',
  'cs.HC': 'HCI', 'cs.NE': 'NE',  'cs.NI': 'Net', 'cs.AR': 'Arch',
  'cs.OS': 'OS',  'cs.CC': 'CC',
};

function catLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.replace('cs.', '');
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  return iso.slice(0, 7); // YYYY-MM
}

// ─── Column header button ─────────────────────────────────────────────────────

function ColHeader({
  label, icon, sortKey, current, dir, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onClick(sortKey)}
      className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider
        transition-colors whitespace-nowrap
        ${active ? 'text-neon-red/80' : 'text-neon-red/35 hover:text-neon-red/60'}`}
    >
      {icon}
      {label}
      {active
        ? dir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />
        : <ChevronsUpDown size={10} className="opacity-40" />}
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AuthorsClient({ initialAuthors, total }: Props) {
  const [query, setQuery]   = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('paperCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [catFilter, setCatFilter] = useState('');

  // Unique top categories present in the data
  const topCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of initialAuthors) {
      if (a.topCategory) counts[a.topCategory] = (counts[a.topCategory] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat]) => cat);
  }, [initialAuthors]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); return key; }
      setSortDir('desc');
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = initialAuthors;

    if (q)         list = list.filter(a => a.name.toLowerCase().includes(q));
    if (catFilter) list = list.filter(a => a.topCategory === catFilter);

    return [...list].sort((a, b) => {
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
      }
      return sortDir === 'desc'
        ? (vb as number) - (va as number)
        : (va as number) - (vb as number);
    });
  }, [initialAuthors, query, catFilter, sortKey, sortDir]);

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neon-red/30 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search authors…"
            className="w-full pl-8 pr-8 py-1.5 text-xs font-mono
              bg-neutral-900 border border-neon-red/20 rounded-lg
              text-white placeholder-neutral-600
              focus:outline-none focus:border-neon-red/40 transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neon-red/30 hover:text-neon-red/60">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCatFilter('')}
            className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all
              ${!catFilter
                ? 'border-neon-red/50 bg-neon-red/10 text-neon-red'
                : 'border-neon-red/15 text-neon-red/40 hover:border-neon-red/30'}`}
          >
            All
          </button>
          {topCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(catFilter === cat ? '' : cat)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all
                ${catFilter === cat
                  ? 'border-neon-red/50 bg-neon-red/10 text-neon-red'
                  : 'border-neon-red/15 text-neon-red/40 hover:border-neon-red/30'}`}
            >
              {catLabel(cat)}
            </button>
          ))}
        </div>

        {/* Count */}
        <span className="ml-auto text-[10px] font-mono text-neon-red/25 whitespace-nowrap">
          {filtered.length} / {total} authors
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-neon-red/10">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-neon-red/10 bg-neutral-950/60">
              <th className="text-left px-3 py-2.5 text-neon-red/35 text-[10px] uppercase tracking-wider w-8">#</th>
              <th className="text-left px-3 py-2.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neon-red/35">Author</span>
              </th>
              <th className="px-3 py-2.5 text-center">
                <ColHeader label="Papers" icon={<BookOpen size={10} />}
                  sortKey="paperCount" current={sortKey} dir={sortDir} onClick={handleSort} />
              </th>
              <th className="px-3 py-2.5 text-center hidden md:table-cell">
                <ColHeader label="Code" icon={<Code size={10} />}
                  sortKey="codeCount" current={sortKey} dir={sortDir} onClick={handleSort} />
              </th>
              <th className="px-3 py-2.5 text-center hidden lg:table-cell">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neon-red/35">Area</span>
              </th>
              <th className="px-3 py-2.5 text-center hidden lg:table-cell">
                <ColHeader label="Latest" icon={null}
                  sortKey="latestPaper" current={sortKey} dir={sortDir} onClick={handleSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-16 text-neon-red/30">
                  No authors found
                </td>
              </tr>
            ) : (
              filtered.map((author, idx) => (
                <tr
                  key={author.name}
                  className="border-b border-neon-red/5 hover:bg-neon-red/5 transition-colors group"
                >
                  {/* Rank */}
                  <td className="px-3 py-3 text-neon-red/20 text-[10px] tabular-nums">
                    {idx + 1}
                  </td>

                  {/* Name → /author/[name] */}
                  <td className="px-3 py-3">
                    <Link
                      href={`/author/${encodeURIComponent(author.name)}`}
                      className="text-white/80 hover:text-neon-red transition-colors font-semibold"
                    >
                      {author.name}
                    </Link>
                  </td>

                  {/* Papers */}
                  <td className="px-3 py-3 text-center tabular-nums text-neon-red/70">
                    {author.paperCount}
                  </td>

                  {/* Code */}
                  <td className="px-3 py-3 text-center hidden md:table-cell text-emerald-400/60">
                    {author.codeCount > 0 ? author.codeCount : '—'}
                  </td>

                  {/* Top area */}
                  <td className="px-3 py-3 text-center hidden lg:table-cell">
                    {author.topCategory ? (
                      <span className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-neon-red/15 text-neon-red/50">
                        {catLabel(author.topCategory)}
                      </span>
                    ) : '—'}
                  </td>

                  {/* Latest */}
                  <td className="px-3 py-3 text-center hidden lg:table-cell text-neon-red/30">
                    {fmtDate(author.latestPaper)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 200 && (
        <p className="mt-4 text-[10px] font-mono text-neon-red/25 text-center">
          Showing top 200 authors by paper count. Use search to find others.
        </p>
      )}
    </div>
  );
}
