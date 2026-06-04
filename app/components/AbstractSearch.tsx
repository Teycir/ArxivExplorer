'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Sparkles } from 'lucide-react';

export function AbstractSearch() {
  const [text, setText] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const handleSearch = () => {
    if (!text.trim()) return;
    const params = new URLSearchParams({ embedText: text.trim() });
    router.push(`/search?${params}`);
  };

  return (
    <div className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-mono text-neon-red/60 hover:text-neon-red transition-colors mb-3"
      >
        <Sparkles size={14} />
        {isOpen ? 'Hide' : 'Find similar papers from text'}
      </button>

      {isOpen && (
        <div className="border border-neon-red/10 rounded-lg p-4 bg-black/20">
          <div className="flex items-start gap-3 mb-3">
            <FileText size={16} className="text-neon-red/40 mt-1 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-mono text-neon-red/50 mb-2">
                Paste an abstract or paper text to find similar papers in the index
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste abstract or paper text here..."
                className="w-full h-32 px-3 py-2 bg-black/40 border border-neon-red/20 rounded text-sm font-mono text-white/90 placeholder:text-white/20 focus:border-neon-red/40 focus:outline-none resize-none"
                maxLength={5000}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] font-mono text-neon-red/30">
                  {text.length}/5000 characters
                </span>
                <button
                  onClick={handleSearch}
                  disabled={!text.trim()}
                  className="px-4 py-1.5 bg-neon-red/10 hover:bg-neon-red/20 disabled:bg-neon-red/5 border border-neon-red/30 disabled:border-neon-red/10 rounded text-xs font-mono text-neon-red disabled:text-neon-red/30 transition-colors disabled:cursor-not-allowed"
                >
                  Search
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
