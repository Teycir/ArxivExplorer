'use client';
// app/components/CategoryScopeBar.tsx
// Shows the indexed arXiv categories as clickable chips with a clear scope label.
// Used on the homepage hero and search page to set user expectations.

import Link from 'next/link';
import { Database } from 'lucide-react';

export const INDEXED_CATEGORIES: { id: string; label: string; desc: string }[] = [
  { id: 'cs.AI',  label: 'cs.AI',  desc: 'Artificial Intelligence' },
  { id: 'cs.LG',  label: 'cs.LG',  desc: 'Machine Learning' },
];

export function CategoryScopeBar() {
  return (
    <div className="flex flex-col items-center gap-2 mt-3">
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-neon-red/35 uppercase tracking-widest">
          <Database size={10} className="text-neon-red/30" />
          Indexed from
        </span>
        {INDEXED_CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            href={`/search?q=${encodeURIComponent(cat.id)}`}
            title={cat.desc}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded
              border border-neon-red/20 bg-neon-red/5
              text-[10px] font-mono font-semibold text-neon-red/60 uppercase tracking-wider
              hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/10
              transition-all duration-150"
          >
            {cat.label}
            <span className="text-neon-red/30 font-normal normal-case tracking-normal hidden sm:inline">
              · {cat.desc}
            </span>
          </Link>
        ))}
        <span className="text-[10px] font-mono text-neon-red/25">only</span>
      </div>
    </div>
  );
}
