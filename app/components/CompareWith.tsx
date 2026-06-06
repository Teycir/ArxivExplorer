'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitCompare } from 'lucide-react';

export function CompareWith({ currentId }: { currentId: string }) {
  const [compareId, setCompareId] = useState('');
  const router = useRouter();

  const handleCompare = () => {
    const ids = [currentId, compareId.trim()].filter(Boolean);
    if (ids.length === 2) {
      router.push(`/compare?ids=${ids.join(',')}`);
    }
  };

  return (
    <div className="flex gap-2 w-full sm:w-auto">
      <input
        type="text"
        placeholder="Compare with ID..."
        value={compareId}
        onChange={(e) => setCompareId(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleCompare()}
        className="flex-1 sm:w-48 px-3 py-1.5 text-xs font-mono
          bg-black/40 border border-neon-red/20 rounded-lg
          text-white/80 placeholder:text-neon-red/30
          focus:outline-none focus:border-neon-red/50 focus:bg-black/60
          transition-all"
      />
      <button
        onClick={handleCompare}
        disabled={!compareId.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
          border border-neon-red/30 text-neon-red/70 rounded-lg
          hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5
          disabled:opacity-30 disabled:cursor-not-allowed
          transition-all"
      >
        <GitCompare size={12} /> Compare
      </button>
    </div>
  );
}
