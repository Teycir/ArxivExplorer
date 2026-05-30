/**
 * app/components/BookmarkDot.tsx
 *
 * Tiny client component — shows a ★ amber dot on PaperCard footers
 * when the paper is already bookmarked in localStorage.
 * Renders nothing on server / before hydration to avoid mismatch.
 */
'use client';

import { useState, useEffect } from 'react';
import { isBookmarked } from '@/lib/bookmarks';

export function BookmarkDot({ id }: { id: string }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(isBookmarked(id));
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
