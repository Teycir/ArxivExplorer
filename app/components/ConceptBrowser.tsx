// app/components/ConceptBrowser.tsx
// Displays Wikidata concept chips from the paper's OpenAlex enrichment.
// Each chip links to /concept/[name] for browsing papers in that concept.

import Link from 'next/link';
import { Card } from './Card';
import { Network } from 'lucide-react';

interface Concept {
  name: string;
  wikidataId: string;
  score: number;
}

interface ConceptBrowserProps {
  concepts: Concept[];
}

/** Map a [0,1] score to a Tailwind opacity class for the chip. */
function scoreToOpacity(score: number): string {
  if (score >= 0.85) return 'opacity-100';
  if (score >= 0.65) return 'opacity-75';
  if (score >= 0.45) return 'opacity-55';
  return 'opacity-35';
}

export function ConceptBrowser({ concepts }: ConceptBrowserProps) {
  if (concepts.length === 0) return null;

  // Sort descending by score, cap at 20 chips
  const sorted = [...concepts].sort((a, b) => b.score - a.score).slice(0, 20);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neon-red/15">
        <Network size={14} className="text-violet-500/60" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-violet-500/60">
          Concepts
        </span>
        <span className="ml-auto text-[10px] font-mono text-neon-red/30">
          via OpenAlex
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {sorted.map((c) => (
          <Link
            key={c.wikidataId}
            href={`/concept/${encodeURIComponent(c.name)}`}
            title={`Score: ${(c.score * 100).toFixed(0)}%`}
            className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border
              border-violet-500/25 bg-violet-500/8 text-violet-300
              hover:border-violet-500/50 hover:bg-violet-500/15 transition-all
              ${scoreToOpacity(c.score)}`}
          >
            {c.name}
          </Link>
        ))}
      </div>
    </Card>
  );
}
