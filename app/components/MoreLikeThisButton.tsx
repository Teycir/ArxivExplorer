/**
 * app/components/MoreLikeThisButton.tsx
 *
 * Ghost button that navigates to /search?like=:id, triggering "more like this"
 * semantic search for a paper.  Client component so we can use router.push.
 */
'use client';

import { useRouter } from 'next/navigation';
import { Tooltip } from './Tooltip';

export function MoreLikeThisButton({ id }: { id: string }) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/search?like=${encodeURIComponent(id)}`);
  }

  return (
    <Tooltip content="Find similar papers by meaning" position="top">
      <button
        onClick={handleClick}
        className="text-[10px] font-mono text-neon-red/30 hover:text-neon-red/70
          border border-neon-red/10 hover:border-neon-red/30 rounded-lg px-1.5 py-0.5
          transition-colors duration-150 whitespace-nowrap"
      >
        ~ more like this
      </button>
    </Tooltip>
  );
}
