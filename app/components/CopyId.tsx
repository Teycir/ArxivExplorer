'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Tooltip } from './Tooltip';

export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = id; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Tooltip content={copied ? 'Copied!' : 'Copy arXiv ID'} position="top">
      <button
        onClick={copy}
        className={[
          'inline-flex items-center gap-1 text-xs font-mono transition-all duration-150',
          copied ? 'text-green-400' : 'text-neon-red/30 hover:text-neon-red/70',
        ].join(' ')}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {id}
      </button>
    </Tooltip>
  );
}
