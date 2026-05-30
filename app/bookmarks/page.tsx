// app/bookmarks/page.tsx
// Static page — all data comes from client-side localStorage.

import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { BookmarksList } from '../components/BookmarksList';
import { Bookmark as BookmarkIcon } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Bookmarks — ArXiv Explorer',
  description: 'Your saved arXiv papers, stored locally in your browser.',
  robots: { index: false },
};

export default function BookmarksPage() {
  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto w-full px-4 py-10 flex-1">
        <div className="flex items-center gap-3 mb-8">
          <BookmarkIcon size={20} className="text-neon-red/60" />
          <h1 className="text-white/90 font-mono font-bold text-xl tracking-wide">
            Bookmarks
          </h1>
          <span className="text-xs text-neon-red/30 font-mono ml-auto">
            stored in your browser · 90-day TTL
          </span>
        </div>

        <div className="space-y-4">
          <BookmarksList />
        </div>
      </main>
    </>
  );
}
