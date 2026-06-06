'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyAbstract({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-neon-red/40 hover:text-neon-red/70 transition-colors"
      aria-label="Copy abstract"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
