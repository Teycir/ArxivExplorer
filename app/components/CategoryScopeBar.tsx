'use client';
// app/components/CategoryScopeBar.tsx
// Shows the indexed arXiv CS categories as clickable chips with a clear scope label.
// Used on the homepage hero and search page to set user expectations.

import { Database, Lock } from 'lucide-react';

export const INDEXED_CATEGORIES: { id: string; label: string; desc: string }[] = [
  // Core ML / AI
  { id: 'cs.AI',  label: 'cs.AI',  desc: 'Artificial Intelligence' },
  { id: 'cs.LG',  label: 'cs.LG',  desc: 'Machine Learning' },
  { id: 'cs.CL',  label: 'cs.CL',  desc: 'Natural Language Processing' },
  { id: 'cs.CV',  label: 'cs.CV',  desc: 'Computer Vision' },
  { id: 'cs.NE',  label: 'cs.NE',  desc: 'Neural & Evolutionary Computing' },
  // Systems & Architecture
  { id: 'cs.DC',  label: 'cs.DC',  desc: 'Distributed & Parallel Computing' },
  { id: 'cs.AR',  label: 'cs.AR',  desc: 'Hardware Architecture' },
  { id: 'cs.OS',  label: 'cs.OS',  desc: 'Operating Systems' },
  // Security & Cryptography
  { id: 'cs.CR',  label: 'cs.CR',  desc: 'Cryptography & Security' },
  // Theory & Algorithms
  { id: 'cs.DS',  label: 'cs.DS',  desc: 'Data Structures & Algorithms' },
  { id: 'cs.CC',  label: 'cs.CC',  desc: 'Computational Complexity' },
  { id: 'cs.IT',  label: 'cs.IT',  desc: 'Information Theory' },
  // Software & PL
  { id: 'cs.SE',  label: 'cs.SE',  desc: 'Software Engineering' },
  { id: 'cs.PL',  label: 'cs.PL',  desc: 'Programming Languages' },
  { id: 'cs.DB',  label: 'cs.DB',  desc: 'Databases' },
  // Robotics & HCI
  { id: 'cs.RO',  label: 'cs.RO',  desc: 'Robotics' },
  { id: 'cs.HC',  label: 'cs.HC',  desc: 'Human-Computer Interaction' },
  // Networks
  { id: 'cs.NI',  label: 'cs.NI',  desc: 'Networking & Internet' },
];

/** All valid category IDs — used for query scoping guard */
export const VALID_CATEGORY_IDS = new Set(INDEXED_CATEGORIES.map(c => c.id));

export function CategoryScopeBar() {
  return (
    <div className="flex flex-col items-center gap-3 mt-3 w-full">
      {/* Lock banner */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neon-red/20 bg-neon-red/5">
        <Lock size={10} className="text-neon-red/50 flex-shrink-0" />
        <span className="text-[10px] font-mono text-neon-red/60 uppercase tracking-widest">
          CS papers only · searches outside these topics are blocked
        </span>
      </div>

      {/* Category chips */}
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-neon-red/35 uppercase tracking-widest mr-1">
          <Database size={10} className="text-neon-red/30" />
          Indexed
        </span>
        {INDEXED_CATEGORIES.map((cat) => (
          <span
            key={cat.id}
            title={cat.desc}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded
              border border-neon-red/15 bg-neon-red/5
              text-[10px] font-mono font-semibold text-neon-red/50 uppercase tracking-wider
              select-none"
          >
            {cat.label}
          </span>
        ))}
      </div>
    </div>
  );
}
