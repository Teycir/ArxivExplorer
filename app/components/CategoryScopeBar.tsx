'use client';
// app/components/CategoryScopeBar.tsx
// Shows the indexed arXiv CS categories as clickable chips that filter search.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Database } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { CATEGORY_LABELS } from '@/lib/categories';

export const INDEXED_CATEGORIES: { id: string; label: string; desc: string }[] = [
  // Core ML / AI
  { id: 'cs.AI',  label: 'cs.AI',  desc: CATEGORY_LABELS['cs.AI'] || 'Artificial Intelligence' },
  { id: 'cs.LG',  label: 'cs.LG',  desc: CATEGORY_LABELS['cs.LG'] || 'Machine Learning' },
  { id: 'cs.CL',  label: 'cs.CL',  desc: CATEGORY_LABELS['cs.CL'] || 'Computation and Language' },
  { id: 'cs.CV',  label: 'cs.CV',  desc: CATEGORY_LABELS['cs.CV'] || 'Computer Vision' },
  { id: 'cs.NE',  label: 'cs.NE',  desc: CATEGORY_LABELS['cs.NE'] || 'Neural and Evolutionary Computing' },
  // Systems & Architecture
  { id: 'cs.DC',  label: 'cs.DC',  desc: CATEGORY_LABELS['cs.DC'] || 'Distributed Computing' },
  { id: 'cs.AR',  label: 'cs.AR',  desc: CATEGORY_LABELS['cs.AR'] || 'Hardware Architecture' },
  { id: 'cs.OS',  label: 'cs.OS',  desc: CATEGORY_LABELS['cs.OS'] || 'Operating Systems' },
  // Security & Cryptography
  { id: 'cs.CR',  label: 'cs.CR',  desc: CATEGORY_LABELS['cs.CR'] || 'Cryptography and Security' },
  // Theory & Algorithms
  { id: 'cs.DS',  label: 'cs.DS',  desc: CATEGORY_LABELS['cs.DS'] || 'Data Structures and Algorithms' },
  { id: 'cs.CC',  label: 'cs.CC',  desc: CATEGORY_LABELS['cs.CC'] || 'Computational Complexity' },
  { id: 'cs.IT',  label: 'cs.IT',  desc: CATEGORY_LABELS['cs.IT'] || 'Information Theory' },
  // Software & PL
  { id: 'cs.SE',  label: 'cs.SE',  desc: CATEGORY_LABELS['cs.SE'] || 'Software Engineering' },
  { id: 'cs.PL',  label: 'cs.PL',  desc: CATEGORY_LABELS['cs.PL'] || 'Programming Languages' },
  { id: 'cs.DB',  label: 'cs.DB',  desc: CATEGORY_LABELS['cs.DB'] || 'Databases' },
  // Robotics & HCI
  { id: 'cs.RO',  label: 'cs.RO',  desc: CATEGORY_LABELS['cs.RO'] || 'Robotics' },
  { id: 'cs.HC',  label: 'cs.HC',  desc: CATEGORY_LABELS['cs.HC'] || 'Human-Computer Interaction' },
  // Networks
  { id: 'cs.NI',  label: 'cs.NI',  desc: CATEGORY_LABELS['cs.NI'] || 'Networking and Internet Architecture' },
];

/** All valid category IDs — used for category filter validation */
export const VALID_CATEGORY_IDS = new Set(INDEXED_CATEGORIES.map(c => c.id));

export function CategoryScopeBar() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';

  return (
    <div className="flex flex-col items-center gap-3 mt-3 w-full">
      {/* Category chips */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-neon-red/35 uppercase tracking-widest mr-1">
          <Database size={10} className="text-neon-red/30" />
          Indexed
        </span>
        {INDEXED_CATEGORIES.map((cat) => (
          <Tooltip key={cat.id} content={cat.desc} position="top">
            <Link
              href={q ? `/search?q=${encodeURIComponent(q)}&category=${cat.id}` : `/search?q=&category=${cat.id}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                border border-neon-red/15 bg-neon-red/5
                text-[10px] font-mono font-semibold text-neon-red/50 uppercase tracking-wider
                hover:border-neon-red/40 hover:bg-neon-red/10 hover:text-neon-red/80
                transition-all cursor-pointer select-none"
            >
              {cat.label}
            </Link>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
