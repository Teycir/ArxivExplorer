/**
 * app/components/CopyBibtex.tsx
 *
 * One-click BibTeX copy button for a paper.
 * Constructs the citation entirely from existing paper data — no API call.
 *
 * Output format:
 *   @misc{authorYYYY_id,
 *     title     = {...},
 *     author    = {Last, First and ...},
 *     year      = {YYYY},
 *     eprint    = {NNNN.NNNNN},
 *     archivePrefix = {arXiv},
 *     primaryClass  = {cs.LG},
 *     url       = {https://arxiv.org/abs/NNNN.NNNNN},
 *   }
 */
'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyBibtexProps {
  id:         string;
  title:      string;
  authors:    string[];
  categories: string[];
  publishedAt: string; // YYYY-MM-DD
}

function buildBibtex({ id, title, authors, categories, publishedAt }: CopyBibtexProps): string {
  const year   = publishedAt.split('-')[0] ?? '2024';
  const first  = authors[0] ?? 'Unknown';
  // Build citation key: firstAuthorLastName + year + first4 of arxiv id (no dots)
  const lastName  = first.split(' ').pop()?.toLowerCase().replace(/[^a-z]/g, '') ?? 'unknown';
  const shortId   = id.replace('.', '').slice(0, 6);
  const citeKey   = `${lastName}${year}_${shortId}`;
  const primary   = categories[0] ?? 'cs.LG';

  // Format authors as "Last, First and Last, First"
  const authorStr = authors
    .map(a => {
      const parts = a.trim().split(' ');
      if (parts.length === 1) return a;
      const last  = parts.pop()!;
      return `${last}, ${parts.join(' ')}`;
    })
    .join(' and ');

  // Escape title braces for BibTeX
  const safeTitle = title.replace(/[{}]/g, '');

  return [
    `@misc{${citeKey},`,
    `  title         = {{${safeTitle}}},`,
    `  author        = {${authorStr}},`,
    `  year          = {${year}},`,
    `  eprint        = {${id}},`,
    `  archivePrefix = {arXiv},`,
    `  primaryClass  = {${primary}},`,
    `  url           = {https://arxiv.org/abs/${id}},`,
    `}`,
  ].join('\n');
}

export function CopyBibtex(props: CopyBibtexProps) {
  const [state, setState] = useState<'idle' | 'copied'>('idle');

  async function copy() {
    const bib = buildBibtex(props);
    try {
      await navigator.clipboard.writeText(bib);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = bib;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    }
  }

  return (
    <button
      onClick={copy}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5',
        'text-xs font-mono transition-all duration-150',
        state === 'copied'
          ? 'border-green-500/40 text-green-400 bg-green-500/10'
          : 'border-neon-red/20 text-neon-red/50 hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5',
      ].join(' ')}
      aria-label="Copy BibTeX citation"
    >
      {state === 'copied'
        ? <><Check size={12} /> Copied!</>
        : <><Copy size={12} /> BibTeX</>
      }
    </button>
  );
}
