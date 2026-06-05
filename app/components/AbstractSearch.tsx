'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ArrowRight, X } from 'lucide-react';

export function AbstractSearch({ onSearch }: { onSearch?: () => void }) {
  const [text, setText] = useState('');
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSearch = () => {
    if (!text.trim()) return;
    onSearch?.();
    router.push(`/search?${new URLSearchParams({ embedText: text.trim() })}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSearch();
  };

  const charCount = text.length;
  const isReady = text.trim().length > 20;

  // ── Navbar popover variant ────────────────────────────────────────────────
  if (onSearch) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-mono text-amber-400/50 leading-relaxed">
          Paste an abstract or any paper text — we'll find semantically similar papers.
        </p>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste abstract or paper text here…"
          className="w-full h-36 px-3 py-2.5
            bg-amber-950/20 border border-amber-500/25 rounded-lg
            text-sm font-mono text-white/90 placeholder:text-amber-900/60
            focus:border-amber-500/50 focus:outline-none
            resize-none transition-colors"
          maxLength={5000}
          autoFocus
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-amber-500/30">{charCount}/5000</span>
          <button
            onClick={handleSearch}
            disabled={!isReady}
            className="flex items-center gap-2 px-4 py-1.5
              bg-amber-500/10 hover:bg-amber-500/20 disabled:bg-transparent
              border border-amber-500/30 disabled:border-amber-500/10 rounded
              text-xs font-mono text-amber-400 disabled:text-amber-500/25
              transition-all disabled:cursor-not-allowed"
          >
            Find similar
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    );
  }

  // ── Standalone variant (search page) ─────────────────────────────────────
  return (
    <div className="mb-8">
      {/* Label above */}
      <div className="flex items-center gap-2 mb-2.5">
        <FileText size={13} className="text-amber-500/60 flex-shrink-0" />
        <span className="text-[11px] font-mono font-semibold uppercase tracking-widest text-amber-500/60">
          Abstract Search
        </span>
        <span className="text-[10px] font-mono text-amber-500/30 normal-case tracking-normal">
          — paste any paper text to find semantically similar papers
        </span>
      </div>

      {/* Card */}
      <div className="relative rounded-xl border border-amber-500/20 bg-amber-950/10
        hover:border-amber-500/30 focus-within:border-amber-500/45
        focus-within:bg-amber-950/15
        focus-within:shadow-[0_0_28px_rgba(245,158,11,0.07)]
        transition-all duration-200">

        {/* Textarea */}
        <div className="px-4 pt-3.5 pb-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste your abstract, introduction, or any paper text here…"
            className="w-full min-h-[72px] px-0 py-0 bg-transparent
              text-sm font-mono text-white/85 placeholder:text-amber-900/50
              focus:outline-none resize-none leading-relaxed"
            style={{ height: text ? 'auto' : undefined, minHeight: '72px' }}
            maxLength={5000}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.max(72, el.scrollHeight) + 'px';
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 pb-3.5">
          <span className="text-[10px] font-mono text-amber-500/25">
            {charCount > 0 ? (
              <>
                <span className={charCount > 4500 ? 'text-amber-400/70' : ''}>{charCount}</span>
                <span className="text-amber-500/15">/5000</span>
                <span className="ml-2 text-amber-500/20">· ⌘↵ to search</span>
              </>
            ) : (
              <span className="text-amber-500/20">⌘↵ to search</span>
            )}
          </span>
          <button
            onClick={handleSearch}
            disabled={!isReady}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg
              bg-amber-500/10 hover:bg-amber-500/18 active:bg-amber-500/25 disabled:bg-transparent
              border border-amber-500/25 hover:border-amber-500/50 disabled:border-amber-500/10
              text-xs font-mono font-semibold text-amber-400 disabled:text-amber-500/25
              transition-all duration-150 disabled:cursor-not-allowed"
          >
            Find similar papers
            <ArrowRight size={12} />
          </button>
        </div>

        {/* Clear button — only when text present */}
        {text && (
          <button
            onClick={() => { setText(''); textareaRef.current?.focus(); }}
            className="absolute top-3 right-3 text-amber-500/25 hover:text-amber-400/60 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
