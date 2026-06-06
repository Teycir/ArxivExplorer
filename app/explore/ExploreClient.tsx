'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface Topic {
  slug: string;
  label: string;
  paperCount: number;
  categoryDetails?: { code: string; label: string }[];
}
interface Paper {
  id: string;
  title: string;
  summary?: { tldr?: string } | null;
}
interface Props {
  totalPapers: number;
  allTopics: Topic[];
  sortedTopics: Topic[];
  topTopics: Topic[];
  trendingPapers: Paper[];
}

export function ExploreClient({ totalPapers, allTopics, sortedTopics, trendingPapers }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const max = sortedTopics[0]?.paperCount ?? 1;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 font-mono">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between mb-6 border-b border-neon-red/10 pb-4">
        <div>
          <p className="text-neon-red/40 text-[10px] uppercase tracking-[0.25em] mb-1 flex items-center gap-2">
            <span className="w-4 h-px bg-neon-red/30 inline-block" />
            explore
          </p>
          <h1 className="text-xl font-bold text-white/90 tracking-tight">Discover CS Research</h1>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-white/30">
          <span>
            <span className="text-neon-red/70 font-bold tabular-nums">{totalPapers.toLocaleString()}</span>
            {' '}papers
          </span>
          <span>
            <span className="text-neon-red/70 font-bold tabular-nums">{allTopics.length}</span>
            {' '}topics
          </span>
          <span className="flex items-center gap-2 text-white/20">
            <Link href="/claim"   className="hover:text-neon-red/60 transition-colors">⚖ Claims</Link>
            <span>·</span>
            <Link href="/compare" className="hover:text-neon-red/60 transition-colors">⊞ Compare</Link>
          </span>
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">

        {/* ── LEFT: topic bar chart ─────────────────────────────────────── */}
        <section>
          <p className="text-neon-red/40 text-[10px] uppercase tracking-widest mb-3">
            Topics — sorted by paper count
          </p>
          <div className="space-y-px">
            {sortedTopics.map((t) => {
              const pct = Math.round((t.paperCount / max) * 100);
              const isHov = hovered === t.slug;
              return (
                <Link
                  key={t.slug}
                  href={`/topic/${t.slug}`}
                  onMouseEnter={() => setHovered(t.slug)}
                  onMouseLeave={() => setHovered(null)}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded
                    hover:bg-neon-red/[0.04] transition-colors duration-100"
                >
                  {/* Topic name — fixed width */}
                  <span
                    className="w-36 shrink-0 text-[11px] truncate transition-colors duration-100"
                    style={{ color: isHov ? '#00ff41' : 'rgba(255,255,255,0.55)' }}
                  >
                    {t.label}
                  </span>

                  {/* Category codes */}
                  <span className="flex items-center gap-1 shrink-0 w-32">
                    {(t.categoryDetails ?? []).slice(0, 3).map(cat => (
                      <span
                        key={cat.code}
                        title={cat.label}
                        className="px-1 py-px rounded text-[8px] font-mono border"
                        style={{
                          background:  'rgba(0,255,65,0.04)',
                          borderColor: isHov ? 'rgba(0,255,65,0.30)' : 'rgba(0,255,65,0.12)',
                          color:       isHov ? 'rgba(0,255,65,0.80)' : 'rgba(0,255,65,0.35)',
                        }}
                      >
                        {cat.code}
                      </span>
                    ))}
                  </span>

                  {/* Bar */}
                  <div className="flex-1 h-1.5 bg-neon-red/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-150"
                      style={{
                        width: `${pct}%`,
                        background: isHov
                          ? 'rgba(0,255,65,0.70)'
                          : 'rgba(0,255,65,0.28)',
                        boxShadow: isHov ? '0 0 6px rgba(0,255,65,0.4)' : 'none',
                      }}
                    />
                  </div>

                  {/* Count */}
                  <span
                    className="w-12 text-right text-[10px] tabular-nums shrink-0 transition-colors duration-100"
                    style={{ color: isHov ? 'rgba(0,255,65,0.80)' : 'rgba(255,255,255,0.25)' }}
                  >
                    {t.paperCount.toLocaleString()}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── RIGHT: trending + discover ───────────────────────────────────── */}
        <aside className="space-y-6">

          {/* Trending */}
          {trendingPapers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-neon-red/40 text-[10px] uppercase tracking-widest">Trending this week</p>
                <span className="relative flex h-1.5 w-1.5 ml-auto shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-red opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon-red" />
                </span>
              </div>
              <div className="space-y-px">
                {trendingPapers.map((p, i) => (
                  <Link
                    key={p.id}
                    href={`/paper/${encodeURIComponent(p.id)}`}
                    className="group flex items-start gap-2 px-2 py-1.5 rounded
                      hover:bg-neon-red/[0.04] transition-colors duration-100"
                  >
                    <span className="text-neon-red/25 text-[10px] tabular-nums w-4 shrink-0 pt-px
                      group-hover:text-neon-red/50 transition-colors">
                      {i + 1}
                    </span>
                    <span className="text-[11px] text-white/50 leading-snug line-clamp-2
                      group-hover:text-white/90 transition-colors duration-100">
                      {p.title}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Divider */}
          <div className="h-px bg-neon-red/10" />

          {/* Discover tools */}
          <section>
            <p className="text-neon-red/40 text-[10px] uppercase tracking-widest mb-3">Tools</p>
            <div className="space-y-1">
              {[
                { href: '/claim',   label: 'Claim Tracker',  sub: 'Support / contradict a claim' },
                { href: '/compare', label: 'Compare Papers', sub: 'Side-by-side diff'            },
              ].map(({ href, label, sub }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center justify-between px-2 py-2 rounded
                    border border-neon-red/10 hover:border-neon-red/30 hover:bg-neon-red/[0.04]
                    transition-all duration-100"
                >
                  <div>
                    <p className="text-[11px] text-white/60 group-hover:text-white/90 transition-colors">{label}</p>
                    <p className="text-[10px] text-white/20 group-hover:text-white/35 transition-colors">{sub}</p>
                  </div>
                  <span className="text-neon-red/20 group-hover:text-neon-red/60 text-xs
                    group-hover:translate-x-0.5 transition-all duration-100">→</span>
                </Link>
              ))}
            </div>
          </section>

        </aside>
      </div>
    </main>
  );
}
