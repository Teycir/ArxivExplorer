/**
 * app/components/ExportButton.tsx
 *
 * Multi-format export dropdown for a paper.
 * Formats: BibTeX · Markdown · Plain text · JSON
 *
 * All formats are built entirely from existing page data — no extra API call.
 * Replaces the old CopyBibtex button; CopyBibtex is kept for back-compat.
 */
'use client';

import { useState, useRef, useEffect } from 'react';
import { Download, Check, ChevronDown } from 'lucide-react';
import type { Summary } from '@/src/shared/types';

export interface ExportButtonProps {
  id:          string;
  title:       string;
  authors:     string[];
  categories:  string[];
  publishedAt: string;          // YYYY-MM-DD
  summary?:    Summary | null;
}

type Format = 'bibtex' | 'markdown' | 'text' | 'json';

const FORMAT_LABELS: Record<Format, string> = {
  bibtex:   'BibTeX',
  markdown: 'Markdown',
  text:     'Plain text',
  json:     'JSON',
};

// ── Format builders ───────────────────────────────────────────────────────────

function buildBibtex(p: ExportButtonProps): string {
  const year     = p.publishedAt.split('-')[0] ?? '2024';
  const first    = p.authors[0] ?? 'Unknown';
  const lastName = first.split(' ').pop()?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown';
  const shortId  = p.id.replace('.', '').slice(0, 6);
  const citeKey  = `${lastName}${year}_${shortId}`;
  const primary  = p.categories[0] ?? 'cs.LG';
  const authorStr = p.authors
    .map(a => { const parts = a.trim().split(' '); if (parts.length === 1) return a; const last = parts.pop()!; return `${last}, ${parts.join(' ')}`; })
    .join(' and ');
  const safeTitle = p.title.replace(/[{}]/g, '');
  return [
    `@misc{${citeKey},`,
    `  title         = {{${safeTitle}}},`,
    `  author        = {${authorStr}},`,
    `  year          = {${year}},`,
    `  eprint        = {${p.id}},`,
    `  archivePrefix = {arXiv},`,
    `  primaryClass  = {${primary}},`,
    `}`,
  ].join('\n');
}

function buildMarkdown(p: ExportButtonProps): string {
  const s = p.summary;
  const lines: string[] = [
    `# ${p.title}`,
    ``,
    `**Authors:** ${p.authors.join(', ')}  `,
    `**Published:** ${p.publishedAt}  `,
    `**Categories:** ${p.categories.join(', ')}  `,
    `**arXiv ID:** ${p.id}`,
    ``,
  ];
  if (s?.tldr) {
    lines.push(`## TL;DR`, ``, s.tldr, ``);
  }
  if (s?.keyContributions?.length) {
    lines.push(`## Key Contributions`, ``);
    s.keyContributions.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    lines.push(``);
  }
  if (s?.methods?.length) {
    lines.push(`## Methods`, ``);
    s.methods.forEach(m => lines.push(`- ${m}`));
    lines.push(``);
  }
  if (s?.limitations?.length) {
    lines.push(`## Limitations`, ``);
    s.limitations.forEach(l => lines.push(`- ${l}`));
    lines.push(``);
  }
  return lines.join('\n');
}

function buildPlainText(p: ExportButtonProps): string {
  const s = p.summary;
  const lines: string[] = [
    p.title,
    `${'─'.repeat(60)}`,
    `Authors:    ${p.authors.join(', ')}`,
    `Published:  ${p.publishedAt}`,
    `Categories: ${p.categories.join(', ')}`,
    `arXiv ID:   ${p.id}`,
    ``,
  ];
  if (s?.tldr) {
    lines.push(`TL;DR`, `─────`, s.tldr, ``);
  }
  if (s?.keyContributions?.length) {
    lines.push(`Key Contributions`, `─────────────────`);
    s.keyContributions.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    lines.push(``);
  }
  if (s?.methods?.length) {
    lines.push(`Methods`, `───────`);
    s.methods.forEach(m => lines.push(`  • ${m}`));
    lines.push(``);
  }
  if (s?.limitations?.length) {
    lines.push(`Limitations`, `───────────`);
    s.limitations.forEach(l => lines.push(`  ⚠ ${l}`));
    lines.push(``);
  }
  return lines.join('\n');
}

function buildJson(p: ExportButtonProps): string {
  const payload = {
    id:          p.id,
    title:       p.title,
    authors:     p.authors,
    categories:  p.categories,
    publishedAt: p.publishedAt,
    summary:     p.summary ?? null,
  };
  return JSON.stringify(payload, null, 2);
}

const BUILDERS: Record<Format, (p: ExportButtonProps) => string> = {
  bibtex:   buildBibtex,
  markdown: buildMarkdown,
  text:     buildPlainText,
  json:     buildJson,
};

// ── Clipboard helper ──────────────────────────────────────────────────────────

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExportButton(props: ExportButtonProps) {
  const [open,   setOpen]   = useState(false);
  const [copied, setCopied] = useState<Format | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function handleSelect(fmt: Format) {
    const text = BUILDERS[fmt](props);
    await copyToClipboard(text);
    setCopied(fmt);
    setOpen(false);
    setTimeout(() => setCopied(null), 2500);
  }

  const isCopied = copied !== null;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={[
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5',
          'text-xs font-mono transition-all duration-150',
          isCopied
            ? 'border-green-500/40 text-green-400 bg-green-500/10'
            : 'border-neon-red/20 text-neon-red/50 hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5',
        ].join(' ')}
        aria-label="Export citation or summary"
      >
        {isCopied ? (
          <><Check size={12} /> {FORMAT_LABELS[copied!]} copied!</>
        ) : (
          <><Download size={12} /> Export <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px]
          rounded-lg border border-neon-red/20 bg-dark-bg shadow-xl
          divide-y divide-neon-red/10 overflow-hidden
          animate-in fade-in slide-in-from-top-1 duration-100">
          {(Object.keys(FORMAT_LABELS) as Format[]).map(fmt => (
            <button
              key={fmt}
              onClick={() => handleSelect(fmt)}
              className="w-full text-left px-3 py-2 text-xs font-mono
                text-neon-red/50 hover:text-neon-red hover:bg-neon-red/5
                transition-colors duration-100"
            >
              {FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
