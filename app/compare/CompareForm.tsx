'use client';
/**
 * app/compare/CompareForm.tsx
 * Client component: interactive form to build a /compare?ids=... URL.
 * Lets users add up to 6 arXiv paper IDs, then navigates to the comparison view.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, ArrowRight, FileText } from 'lucide-react';

const MAX_PAPERS = 6;

// Normalise arXiv IDs: strip "arxiv:", "abs/", "pdf/" prefixes and ".pdf" suffix.
function normaliseId(raw: string): string {
  return raw
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
    .trim();
}

export function CompareForm() {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(['', '']);
  const [error, setError] = useState('');

  function updateId(index: number, value: string) {
    setIds(prev => prev.map((id, i) => (i === index ? value : id)));
    setError('');
  }

  function addRow() {
    if (ids.length < MAX_PAPERS) {
      setIds(prev => [...prev, '']);
    }
  }

  function removeRow(index: number) {
    setIds(prev => prev.filter((_, i) => i !== index));
  }

  function handleSubmit() {
    const cleaned = ids.map(normaliseId).filter(Boolean);
    if (cleaned.length < 2) {
      setError('Add at least 2 paper IDs to compare.');
      return;
    }
    // Deduplicate
    const unique = [...new Set(cleaned)];
    router.push(`/compare?ids=${unique.slice(0, MAX_PAPERS).join(',')}`);
  }

  const validCount = ids.map(normaliseId).filter(Boolean).length;

  return (
    <div className="w-full max-w-xl mx-auto mt-10">
      <div className="space-y-3">
        {ids.map((id, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 text-[10px] font-mono text-neon-red/30 text-right">
              {index + 1}.
            </span>
            <div className="relative flex-1">
              <FileText size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neon-red/25 pointer-events-none" />
              <input
                type="text"
                value={id}
                onChange={e => updateId(index, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (index === ids.length - 1 && ids.length < MAX_PAPERS) {
                      addRow();
                    } else if (index === ids.length - 1) {
                      handleSubmit();
                    }
                  }
                }}
                placeholder={`arXiv ID — e.g. 2301.07041`}
                className="w-full pl-9 pr-3 py-2 text-sm font-mono
                  bg-neutral-900 border border-neon-red/20 rounded-lg
                  text-white placeholder-neutral-600
                  focus:outline-none focus:border-neon-red/50 transition-colors"
              />
            </div>
            {ids.length > 2 && (
              <button
                onClick={() => removeRow(index)}
                className="flex-shrink-0 p-1 text-neon-red/25 hover:text-neon-red/60 transition-colors"
                title="Remove"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="mt-3 text-xs font-mono text-neon-red/70">{error}</p>
      )}

      {/* Actions */}
      <div className="mt-5 flex items-center gap-3">
        {ids.length < MAX_PAPERS && (
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono
              border border-neon-red/20 text-neon-red/50 rounded-lg
              hover:border-neon-red/40 hover:text-neon-red/80 transition-all"
          >
            <Plus size={12} /> Add paper
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={validCount < 2}
          className="flex items-center gap-1.5 px-5 py-1.5 text-xs font-mono font-bold
            bg-neon-red/10 border border-neon-red/40 text-neon-red rounded-lg
            hover:bg-neon-red/20 hover:border-neon-red/70 transition-all
            disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Compare {validCount >= 2 ? `${validCount} papers` : 'papers'}
          <ArrowRight size={12} />
        </button>
      </div>

      <p className="mt-4 text-[10px] font-mono text-neon-red/25 leading-relaxed">
        Paste full arXiv URLs or bare IDs (e.g. <span className="text-neon-red/40">2301.07041</span>).
        Only papers indexed in the database will be shown.
      </p>
    </div>
  );
}
