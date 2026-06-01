/**
 * app/components/BookmarkDot.tsx
 *
 * Tiny client component — shows a ★ amber dot on PaperCard footers
 * when the paper is already bookmarked in localStorage.
 * Renders nothing on server / before hydration to avoid mismatch.
 * Listens to 'arxiv:bookmarks-changed' so it updates in the same tab
 * when the user bookmarks/unbookmarks on the detail page.
 */
'use client';

import { useState, useEffect } from 'react';
import { isBookmarked } from '@/lib/bookmarks';

export function BookmarkDot({ id }: { id: string }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Sync on mount
    setSaved(isBookmarked(id));

    // Re-sync whenever bookmarks change in this tab or another tab
    function sync() { setSaved(isBookmarked(id)); }
    window.addEventListener('arxiv:bookmarks-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('arxiv:bookmarks-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, [id]);

  if (!saved) return null;

  return (
    <span
      className="text-amber-400 text-[11px] font-mono leading-none"
      title="Bookmarked"
      aria-label="Bookmarked"
    >
      ★
    </span>
  );
}
