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
import { Tooltip } from './Tooltip';

export function BookmarkDot({ id }: { id: string }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(isBookmarked(id));
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
    <Tooltip content="Bookmarked" position="top">
      <span
        className="text-amber-400 text-[11px] font-mono leading-none"
        aria-label="Bookmarked"
      >
        ★
      </span>
    </Tooltip>
  );
}
