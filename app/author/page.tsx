/**
 * app/author/page.tsx
 * Authors index — full leaderboard with live client-side search + sort.
 * SSR fetches the top 200 authors; the client filters/sorts in-memory.
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Navbar } from '../components/Navbar';
import { AuthorsClient } from './AuthorsClient';
import { getAuthors } from '@/helper/api';
import { Users, Loader2 } from 'lucide-react';

export const revalidate = 3600; // 1 h ISR — matches KV TTL

export const metadata: Metadata = {
  title: 'Authors — ArxivCSExplorer',
  description: 'Browse all indexed CS paper authors with citation counts, paper counts and top research areas.',
};

async function AuthorsLoader() {
  let data: Awaited<ReturnType<typeof getAuthors>>;
  try {
    data = await getAuthors({ limit: 200 });
  } catch (err) {
    console.error('[authors/page] getAuthors failed:', err);
    // Show an inline error instead of silently rendering an empty list,
    // so users know it's a service issue, not "no authors exist".
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <p className="text-sm font-mono text-red-400">Failed to load authors.</p>
        <p className="text-xs font-mono text-white/30">
          {err instanceof Error ? err.message : 'Service temporarily unavailable — try again.'}
        </p>
      </div>
    );
  }

  return (
    <AuthorsClient
      initialAuthors={data.authors}
      total={data.total}
    />
  );
}

export default function AuthorsPage() {
  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full border border-neon-red/30 bg-neon-red/5
            flex items-center justify-center flex-shrink-0">
            <Users size={18} className="text-neon-red/60" />
          </div>
          <div>
            <h1 className="text-xl font-mono font-bold text-white/90">Authors</h1>
            <p className="text-xs font-mono text-neon-red/40 mt-0.5">
              All researchers indexed in the database — click any name to browse their papers
            </p>
          </div>
        </div>

        <Suspense fallback={
          <div className="flex items-center justify-center py-32">
            <Loader2 size={28} className="text-neon-red/50 animate-spin" />
          </div>
        }>
          <AuthorsLoader />
        </Suspense>
      </main>
    </>
  );
}
