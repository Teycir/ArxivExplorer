/**
 * app/components/AuthorStatsPanel.tsx
 * Roadmap Phase 1 — Author stats cards + publication timeline.
 * Client component (uses hooks for responsive bar chart).
 */
'use client';

import Link from 'next/link';
import { Award, Code2, BookOpen, Clock, BarChart3, Users } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface AuthorStats {
  totalPapers: number;
  topCategories: Array<{ cat: string; count: number }>;
  topCoAuthors: Array<{ name: string; count: number }>;
  timeline: Array<{ year: string; count: number }>;
  recentCount: number;
  codeCount: number;
  openAccCount: number;
  totalInfluentialCites: number;
  benchmarkCount: number;
}

interface AuthorStatsPanelProps {
  stats: AuthorStats;
}

const CAT_LABELS: Record<string, string> = {
  'cs.LG': 'ML', 'cs.CL': 'NLP', 'cs.CV': 'Vision', 'cs.AI': 'AI',
  'cs.CR': 'Crypto', 'cs.RO': 'Robotics', 'cs.SE': 'Software',
  'cs.DC': 'Distributed', 'cs.DS': 'Data Structures', 'cs.NE': 'Neural Computing',
  'cs.GT': 'Game Theory', 'cs.IR': 'Info Retrieval', 'stat.ML': 'Stat.ML',
};

export function AuthorStatsPanel({ stats }: AuthorStatsPanelProps) {
  const maxTimelineCount = Math.max(...stats.timeline.map(t => t.count), 1);

  return (
    <div className="space-y-4">
      {/* ── Quick-stat chips ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatChip
          icon={<Clock size={13} className="text-green-400/70" />}
          label="Recent (6 mo)"
          value={stats.recentCount}
          accent="green"
        />
        <StatChip
          icon={<Code2 size={13} className="text-emerald-400/70" />}
          label="With code"
          value={stats.codeCount}
          accent="emerald"
        />
        <StatChip
          icon={<Award size={13} className="text-amber-400/70" />}
          label="Influential cites"
          value={stats.totalInfluentialCites}
          accent="amber"
        />
        <StatChip
          icon={<BarChart3 size={13} className="text-purple-400/70" />}
          label="Benchmarked"
          value={stats.benchmarkCount}
          accent="purple"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
        {/* ── Publication timeline ─────────────────────────────────────── */}
        {stats.timeline.length > 0 && (
          <div className="border border-neon-red/15 rounded-xl p-4 bg-[rgba(10,10,10,0.5)]">
            <p className="text-[10px] font-mono font-bold text-neon-red/40 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <BookOpen size={10} /> Publications per year
            </p>
            <div className="flex items-end gap-1.5 h-20">
              {stats.timeline.map(({ year, count }) => {
                const heightPct = Math.round((count / maxTimelineCount) * 100);
                return (
                  <div key={year} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                    <span className="text-[9px] font-mono text-neon-red/50 font-semibold">
                      {count}
                    </span>
                    <div
                      className="w-full rounded-sm bg-neon-red/30 hover:bg-neon-red/50 transition-colors cursor-default"
                      style={{ height: `${Math.max(heightPct, 8)}%` }}
                    />
                    <span className="text-[8px] font-mono text-neon-red/30 truncate w-full text-center">
                      {year.slice(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Right column: categories + co-authors ─────────────────── */}
        <div className="space-y-4">
          {/* Top categories */}
          {stats.topCategories.length > 0 && (
            <div className="border border-neon-red/15 rounded-xl p-4 bg-[rgba(10,10,10,0.5)]">
              <p className="text-[10px] font-mono font-bold text-neon-red/40 uppercase tracking-widest mb-3">
                Top categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {stats.topCategories.map(({ cat, count }) => (
                  <Tooltip key={cat} content={`${cat} — ${count} paper${count !== 1 ? 's' : ''}`} position="top">
                    <span
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
                        border border-neon-red/20 bg-neon-red/5 text-neon-red/60 cursor-default"
                    >
                      {CAT_LABELS[cat] ?? cat}
                      <span className="text-neon-red/35">×{count}</span>
                    </span>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* Top co-authors */}
          {stats.topCoAuthors.length > 0 && (
            <div className="border border-neon-red/15 rounded-xl p-4 bg-[rgba(10,10,10,0.5)]">
              <p className="text-[10px] font-mono font-bold text-neon-red/40 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Users size={10} /> Frequent co-authors
              </p>
              <div className="flex flex-col gap-1">
                {stats.topCoAuthors.slice(0, 6).map(({ name, count }) => (
                  <div key={name} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/author/${encodeURIComponent(name)}`}
                      className="text-[10px] font-mono text-neon-red/60 hover:text-neon-red transition-colors truncate"
                    >
                      {name}
                    </Link>
                    <span className="text-[9px] font-mono text-neon-red/30 flex-shrink-0">
                      {count}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface StatChipProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: 'green' | 'emerald' | 'amber' | 'purple';
}

const ACCENT_CLASSES: Record<string, string> = {
  green:   'border-green-500/20   bg-green-500/5   text-green-400/70',
  emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400/70',
  amber:   'border-amber-500/20   bg-amber-500/5   text-amber-400/70',
  purple:  'border-purple-500/20  bg-purple-500/5  text-purple-400/70',
};

function StatChip({ icon, label, value, accent }: StatChipProps) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border px-3 py-3 ${ACCENT_CLASSES[accent]}`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-widest opacity-70">{label}</span>
      </div>
      <span className="text-lg font-mono font-bold text-white/80 leading-none">{value}</span>
    </div>
  );
}
