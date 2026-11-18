'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app error]', error);
  }, [error]);

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 text-center gap-6">
      <AlertTriangle size={48} className="text-neon-red/40" />
      <div>
        <p className="text-xs font-mono text-neon-red/40 uppercase tracking-widest mb-2">Notice</p>
        <h1 className="text-2xl font-mono font-bold text-white/80 mb-3">Something slowed down</h1>
        <p className="text-sm text-white/40 font-mono max-w-sm mx-auto">
          We had a brief hiccup loading this view. You can retry safely.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-2 px-5 py-2 text-xs font-mono font-bold uppercase tracking-wider
            border border-neon-red/40 text-neon-red rounded-lg
            hover:border-neon-red/70 hover:bg-neon-red/10 transition-all cursor-pointer"
        >
          <RefreshCw size={13} />
          Try again
        </button>
        <Link
          href="/"
          className="px-5 py-2 text-xs font-mono font-bold uppercase tracking-wider
            border border-white/20 text-white/60 rounded-lg
            hover:border-white/40 hover:text-white transition-all"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
