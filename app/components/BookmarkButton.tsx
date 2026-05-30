/**
 * app/components/BookmarkButton.tsx
 *
 * Adds/removes the current paper from localStorage bookmarks.
 * States: idle → saving → bookmarked / idle → removing → idle
 * Reads initial state on mount (client-only).
 */
'use client';

import { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import { addBookmark, removeBookmark, isBookmarked } from '@/lib/bookmarks';

interface BookmarkButtonProps {
  id:         string;
  title:      string;
  authors:    string[];
  categories: string[];
}

type State = 'loading' | 'idle' | 'bookmarked' | 'saving' | 'removing';

export function BookmarkButton({ id, title, authors, categories }: BookmarkButtonProps) {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    setState(isBookmarked(id) ? 'bookmarked' : 'idle');
  }, [id]);

  async function toggle() {
    if (state === 'saving' || state === 'removing' || state === 'loading') return;

    if (state === 'bookmarked') {
      setState('removing');
      removeBookmark(id);
      setState('idle');
    } else {
      setState('saving');
      addBookmark({ id, title, authors, categories });
      setState('bookmarked');
    }
  }

  const isActive = state === 'bookmarked';
  const isBusy   = state === 'saving' || state === 'removing' || state === 'loading';

  const label =
    state === 'loading'   ? '…' :
    state === 'saving'    ? '…' :
    state === 'removing'  ? '…' :
    state === 'bookmarked'? '★ saved' :
                            '☆ save';

  return (
    <button
      onClick={toggle}
      disabled={isBusy}
      aria-label={isActive ? 'Remove bookmark' : 'Bookmark this paper'}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5',
        'text-sm font-mono transition-all duration-150',
        isBusy
          ? 'border-neutral-700 text-neutral-500 cursor-wait'
          : isActive
            ? 'border-amber-500/50 text-amber-400 bg-amber-500/10 hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/10'
            : 'border-neon-red/20 text-neon-red/50 hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5',
      ].join(' ')}
    >
      <Bookmark
        size={13}
        className={isActive ? 'fill-amber-400' : ''}
      />
      {label}
    </button>
  );
}
