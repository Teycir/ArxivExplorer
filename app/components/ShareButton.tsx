/**
 * app/components/ShareButton.tsx
 *
 * Shares the current paper via Web Share API (mobile / modern browsers)
 * with a copy-URL fallback. Shows a brief "Copied!" toast on fallback.
 */
'use client';

import { useState } from 'react';
import { Share2, Check, Link as LinkIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface ShareButtonProps {
  id:    string;
  title: string;
  tldr?: string | undefined;
}

export function ShareButton({ id, title, tldr }: ShareButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'shared'>('idle');

  async function share() {
    const url = `${window.location.origin}/paper/${encodeURIComponent(id)}`;
    const text = tldr ? `${title}\n\n${tldr}` : title;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        setState('shared');
        setTimeout(() => setState('idle'), 2000);
        return;
      } catch (e) {
        // User cancelled or share unsupported — fall through to copy
        if ((e as DOMException).name === 'AbortError') return;
      }
    }

    // Fallback: copy URL
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setState('copied');
    setTimeout(() => setState('idle'), 2500);
  }

  const isShared = state === 'shared';
  const isCopied = state === 'copied';

  return (
    <Tooltip content="Share or copy link" position="top">
      <button
        onClick={share}
        aria-label="Share this paper"
        className={[
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5',
          'text-xs font-mono transition-all duration-150',
          isShared || isCopied
            ? 'border-green-500/40 text-green-400 bg-green-500/10'
            : 'border-neon-red/20 text-neon-red/50 hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5',
        ].join(' ')}
      >
        {isShared ? (
          <><Check size={12} /> Shared!</>
        ) : isCopied ? (
          <><Check size={12} /> Link copied!</>
        ) : (
          <><Share2 size={12} /> Share</>
        )}
      </button>
    </Tooltip>
  );
}
