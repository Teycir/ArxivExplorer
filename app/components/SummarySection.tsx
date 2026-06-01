// app/components/SummarySection.tsx
// Renders the AI-generated summary tabs: TL;DR, Contributions, Methods,
// Limitations, Beginner, Technical.
// When the summary is still pending, polls /api/paper/:id every 10 s until ready.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from './Card';
import type { PaperWithSummary } from '@/src/shared/types';
import { getPaper } from '@/helper/api';
import { Sparkles, Info, Loader2, Copy, Check } from 'lucide-react';

type Tab = 'tldr' | 'contributions' | 'methods' | 'limitations' | 'beginner' | 'technical';

const TABS: { id: Tab; label: string }[] = [
  { id: 'tldr',          label: 'TL;DR' },
  { id: 'contributions', label: 'Contributions' },
  { id: 'methods',       label: 'Methods' },
  { id: 'limitations',  label: 'Limitations' },
  { id: 'beginner',     label: 'Beginner' },
  { id: 'technical',    label: 'Technical' },
];

export function SummarySection({ paper: initialPaper }: { paper: PaperWithSummary }) {
  const [active, setActive] = useState<Tab>('tldr');
  const [paper, setPaper] = useState(initialPaper);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getTabText = useCallback((tab: Tab, s: NonNullable<typeof paper.summary>): string => {
    switch (tab) {
      case 'tldr':          return s.tldr;
      case 'beginner':      return s.beginnerExplain;
      case 'technical':     return s.technicalSummary;
      case 'contributions': return s.keyContributions.map((c, i) => `${i + 1}. ${c}`).join('\n');
      case 'methods':       return s.methods.map(m => `• ${m}`).join('\n');
      case 'limitations':   return s.limitations.map(l => `⚠ ${l}`).join('\n');
    }
  }, []);

  async function copyTab() {
    if (!paper.summary) return;
    const text = getTabText(active, paper.summary);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Poll every 10 s while summary is still pending
  useEffect(() => {
    if (paper.summaryReady === 1 || paper.summaryReady === 2) return;

    pollRef.current = setInterval(async () => {
      try {
        const fresh = await getPaper(paper.id);
        if (fresh.summaryReady !== 0) {
          setPaper(fresh);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, 10_000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [paper.id, paper.summaryReady]);

  const s = paper.summary;

  if (!s) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          {paper.summaryReady === 2 ? (
            <>
              <Sparkles size={28} className="text-neon-red/20" />
              <p className="text-xs text-neon-red/40 font-mono">Summary generation failed.</p>
              <p className="text-xs text-white/25 font-mono">The abstract is below.</p>
            </>
          ) : (
            <>
              <Loader2 size={28} className="text-neon-red/30 animate-spin" />
              <p className="text-xs text-neon-red/40 font-mono">AI summary is being generated…</p>
              <p className="text-xs text-white/25 font-mono">Checking every 10 s — no refresh needed.</p>
            </>
          )}
        </div>
      </Card>
    );
  }

  const tabContent: Record<Tab, React.ReactNode> = {
    tldr: (
      <p className="text-sm text-white/75 leading-relaxed">{s.tldr}</p>
    ),
    contributions: (
      <ul className="space-y-2">
        {s.keyContributions.map((c, i) => (
          <li key={i} className="flex gap-2 text-xs text-white/70 leading-relaxed">
            <span className="text-neon-red/50 font-mono font-bold flex-shrink-0">
              {String(i + 1).padStart(2, '0')}
            </span>
            {c}
          </li>
        ))}
      </ul>
    ),
    methods: (
      <ul className="space-y-2">
        {s.methods.map((m, i) => (
          <li key={i} className="flex gap-2 text-xs text-white/70 leading-relaxed">
            <span className="text-neon-red/40 flex-shrink-0">▸</span>
            {m}
          </li>
        ))}
      </ul>
    ),
    limitations: (
      <ul className="space-y-2">
        {s.limitations.map((l, i) => (
          <li key={i} className="flex gap-2 text-xs text-white/60 leading-relaxed">
            <span className="text-amber-500/50 flex-shrink-0">⚠</span>
            {l}
          </li>
        ))}
      </ul>
    ),
    beginner: (
      <p className="text-sm text-white/75 leading-relaxed">{s.beginnerExplain}</p>
    ),
    technical: (
      <p className="text-sm text-white/75 leading-relaxed font-mono text-xs">{s.technicalSummary}</p>
    ),
  };

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neon-red/15">
        <Sparkles size={14} className="text-neon-red/60" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/60">
          AI Summary
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-neon-red/25 font-mono">
          <Info size={10} />
          {s.modelVersion.split('/').pop()}
          <button
            onClick={copyTab}
            aria-label="Copy summary to clipboard"
            className={[
              'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] transition-all',
              copied
                ? 'border-green-500/40 text-green-400 bg-green-500/10'
                : 'border-neon-red/20 text-neon-red/40 hover:border-neon-red/50 hover:text-neon-red/70',
            ].join(' ')}
          >
            {copied ? <><Check size={9} /> copied</> : <><Copy size={9} /> copy</>}
          </button>
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-2.5 py-1 text-xs font-mono font-semibold uppercase tracking-wider
              rounded-md border transition-all duration-150
              ${active === tab.id
                ? 'border-neon-red/50 bg-neon-red/10 text-neon-red'
                : 'border-neon-red/15 text-neon-red/35 hover:border-neon-red/30 hover:text-neon-red/60'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[80px] animate-fade-in">
        {tabContent[active]}
      </div>
    </Card>
  );
}
