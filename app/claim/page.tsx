'use client';

import { useState, useCallback } from 'react';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { Scale, Loader2, CheckCircle, XCircle, MinusCircle, AlertCircle } from 'lucide-react';
import type { PaperWithSummary, SearchResult } from '@/src/shared/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ClassifiedPaper extends PaperWithSummary {
  classification: 'support' | 'contradict' | 'neutral';
  reasoning?: string;
  confidence?: number;
}

type Status = 'idle' | 'searching' | 'classifying' | 'done';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXAMPLES = [
  'Transformers outperform RNNs',
  'Dropout prevents overfitting',
  'Attention improves translation',
  'BERT uses bidirectional',
  'ResNets solve gradient'
];

function sanitizeClaim(input: string): string {
  return input
    .trim()
    .replace(/[<>{}[\]\\]/g, '') // Remove potentially dangerous chars
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .slice(0, 200);               // Hard cap at 200 chars
}

function validateClaim(claim: string): string | null {
  const sanitized = sanitizeClaim(claim);
  const words = sanitized.split(/\s+/).filter(Boolean);
  
  if (words.length < 3) {
    return 'Claim must be at least 3 words (e.g., "Transformers outperform RNNs")';
  }
  
  return null;
}

/**
 * Run tasks with a maximum concurrency cap.
 * Fires up to `limit` tasks at once; starts a new one each time one settles.
 * Results are returned in the original order.
 */
async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      try {
        results[idx] = { status: 'fulfilled', value: await fn(items[idx]!, idx) };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

async function classifyOne(
  claim: string,
  paper: PaperWithSummary,
  attempt = 0
): Promise<ClassifiedPaper> {
  // Always call the Next.js proxy (/api/classify-claim), never the worker
  // directly. The proxy forwards the real client IP via X-Real-IP so the
  // worker rate-limits per user, not per server. Using NEXT_PUBLIC_API_BASE
  // here pointed at the worker directly, bypassing the proxy and collapsing
  // all users into a single rate-limit bucket.
  const res = await fetch(`/api/classify-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claim,
      abstract: paper.abstract,
      tldr: paper.summary?.tldr ?? '',
    }),
  });

  // Retry once on 429 with a short backoff — burst classification can
  // occasionally hit the limit on the first attempt; one retry is enough
  // to recover without hammering the server.
  if (res.status === 429) {
    if (attempt === 0) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '3');
      await new Promise(r => setTimeout(r, Math.min(retryAfter, 10) * 1000));
      return classifyOne(claim, paper, 1);
    }
    const json = await res.json() as { error: string; retryAfter?: number };
    throw new Error(json.error || 'Rate limit exceeded. Please try again later.');
  }

  if (!res.ok) {
    // Throw so the caller knows classification failed — don't silently
    // return 'neutral' which makes every failed call look like a real result.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string; detail?: string };
      detail = body.error ?? body.detail ?? detail;
    } catch { /* non-JSON body — use status code */ }
    throw new Error(`Classification failed (${detail})`);
  }

  const json = await res.json() as { result: 'support' | 'contradict' | 'neutral'; reasoning?: string; confidence?: number };
  const valid = ['support', 'contradict', 'neutral'];
  return {
    ...paper,
    classification: valid.includes(json.result) ? json.result : 'neutral',
    ...(json.reasoning ? { reasoning: json.reasoning } : {}),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ClaimTrackerPage() {
  const [claim, setClaim]     = useState('');
  const [status, setStatus]   = useState<Status>('idle');
  const [results, setResults] = useState<ClassifiedPaper[]>([]);
  const [classified, setClassified] = useState(0);
  const [total, setTotal]     = useState(0);
  const [error, setError]     = useState('');
  const [classifyError, setClassifyError] = useState('');

  const handleSearch = useCallback(async () => {
    const sanitized = sanitizeClaim(claim);
    const validationError = validateClaim(sanitized);
    
    if (validationError) {
      setError(validationError);
      return;
    }

    // Reset ALL state before issuing any network request.
    setStatus('searching');
    setError('');
    setClassifyError('');
    setResults([]);
    setClassified(0);
    setTotal(0);

    // ── Step 1: semantic search for relevant papers ───────────────────────
    let papers: PaperWithSummary[];
    try {
      // Use embedText for pure semantic search - bypasses keyword noise
      const searchRes = await fetch(
        `${API_BASE}/api/search?embedText=${encodeURIComponent(sanitized)}&limit=30`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (!searchRes.ok) throw new Error(`Search failed (${searchRes.status})`);
      const data: SearchResult = await searchRes.json();
      papers = data.papers;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setStatus('idle');
      return;
    }

    if (papers.length === 0) {
      // Don't put this in the error banner (which can linger). Instead
      // transition to 'done' with an empty results array — the empty-state
      // block at the bottom of the render will display the message, and it
      // will be cleared automatically the moment the next search starts
      // (because setResults([]) + setStatus('searching') fires first).
      setStatus('done');
      return;
    }

    // Filter to most relevant papers (semantic search already ranked by relevance)
    // Take top 15 papers - they're already semantically similar to the claim
    papers = papers.slice(0, 15);

    // ── Step 2: classify in parallel (concurrency = 5) ─────────────────────
    setTotal(papers.length);
    setStatus('classifying');

    let failCount = 0;
    let lastError = '';

    try {
      await pMap(papers, async (paper) => {
        try {
          const result = await classifyOne(sanitized, paper);
          setResults(prev => [...prev, result]);
        } catch (err) {
          failCount++;
          lastError = err instanceof Error ? err.message : String(err);
          // Hard stop on rate limit — no point continuing
          if (lastError.includes('Rate limit')) throw err;
          // All other errors (500, 503): skip this paper silently,
          // we'll surface a summary warning at the end.
        } finally {
          setClassified(prev => prev + 1);
        }
      }, 5);
    } catch (err) {
      // Only re-thrown for rate limit
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Rate limit')) {
        setError(msg);
        setStatus('idle');
        return;
      }
    }

    // Surface classification errors as a non-blocking warning so users know
    // results may be incomplete — not silently showing neutral for failures.
    if (failCount > 0) {
      const detail = lastError.length < 120 ? ` (${lastError})` : '';
      setClassifyError(
        failCount === papers.length
          ? `Classification failed for all papers${detail}. The service may be temporarily unavailable — try again in a moment.`
          : `Classification failed for ${failCount} of ${papers.length} papers${detail}. Results below may be incomplete.`
      );
    }

    setStatus('done');
  }, [claim]);

  // ── Derived buckets (computed from progressive results) ───────────────────
  const supports    = results.filter(p => p.classification === 'support');
  const contradicts = results.filter(p => p.classification === 'contradict');
  const neutral     = results.filter(p => p.classification === 'neutral');

  const isLoading   = status === 'searching' || status === 'classifying';
  const progress    = total > 0 ? Math.round((classified / total) * 100) : 0;

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto w-full px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Scale size={28} className="text-neon-red" />
            <h1 className="text-2xl font-mono text-white">Claim Tracker</h1>
          </div>
          <p className="text-sm font-mono text-neon-red/50 max-w-3xl mb-4">
            Enter a scientific claim (minimum 3 words) — papers are retrieved then classified in parallel.
          </p>
          
          {/* Examples */}
          <div className="mb-6">
            <p className="text-xs font-mono text-neon-red/35 mb-2">Example claims:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(example => (
                <button
                  key={example}
                  onClick={() => setClaim(example)}
                  disabled={isLoading}
                  className="px-3 py-1.5 bg-neon-red/5 hover:bg-neon-red/10 border border-neon-red/20 hover:border-neon-red/30 rounded-lg text-xs font-mono text-neon-red/60 hover:text-neon-red transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={claim}
              onChange={e => setClaim(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isLoading && handleSearch()}
              placeholder="Enter at least 3 words..."
              className="flex-1 px-4 py-3 bg-black/40 border border-neon-red/20 rounded-lg text-sm font-mono text-white placeholder:text-white/30 focus:border-neon-red/40 focus:outline-none"
              maxLength={200}
              disabled={isLoading}
            />
            <button
              onClick={handleSearch}
              disabled={!claim.trim() || isLoading}
              className="px-6 py-3 bg-neon-red/10 hover:bg-neon-red/20 disabled:bg-neon-red/5 border border-neon-red/30 disabled:border-neon-red/10 rounded-lg text-sm font-mono text-neon-red disabled:text-neon-red/30 transition-colors disabled:cursor-not-allowed"
            >
              {isLoading ? 'Analyzing…' : 'Search'}
            </button>
          </div>
        </div>

        {/* Search / validation error */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg mb-6">
            <AlertCircle size={16} className="text-red-500" />
            <p className="text-sm font-mono text-red-400">{error}</p>
          </div>
        )}

        {/* Classification warning — service errors that didn't block all results */}
        {classifyError && (
          <div className="flex items-start gap-2 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-6">
            <AlertCircle size={16} className="text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-sm font-mono text-yellow-400">{classifyError}</p>
          </div>
        )}

        {/* Progress bar — visible during classification */}
        {status === 'searching' && (
          <div className="flex items-center justify-center gap-3 py-16 text-neon-red/40 font-mono text-sm">
            <Loader2 size={18} className="animate-spin" />
            <span>Finding relevant papers…</span>
          </div>
        )}

        {status === 'classifying' && (
          <div className="mb-8">
            <div className="flex justify-between text-[10px] font-mono text-neon-red/40 mb-1.5">
              <span>Classifying papers</span>
              <span>{classified} / {total}</span>
            </div>
            <div className="h-px w-full bg-neon-red/10 rounded overflow-hidden">
              <div
                className="h-full bg-neon-red/50 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Results — render as they arrive */}
        {results.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Support */}
            <div>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-green-500/20">
                <CheckCircle size={18} className="text-green-500" />
                <h2 className="text-base font-mono text-green-500">
                  Support ({supports.length})
                </h2>
              </div>
              <div className="space-y-4">
                {supports.map(paper => (
                  <div key={paper.id}>
                    <PaperCard paper={paper} />
                    {paper.reasoning && (
                      <p className="mt-1.5 text-[11px] font-mono text-green-400/55 italic leading-relaxed">
                        {paper.reasoning}
                      </p>
                    )}
                  </div>
                ))}
                {supports.length === 0 && status === 'done' && (
                  <p className="text-sm font-mono text-white/25 italic">No supporting papers found</p>
                )}
              </div>
            </div>

            {/* Contradict */}
            <div>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-red-500/20">
                <XCircle size={18} className="text-red-500" />
                <h2 className="text-base font-mono text-red-500">
                  Contradict ({contradicts.length})
                </h2>
              </div>
              <div className="space-y-4">
                {contradicts.map(paper => (
                  <div key={paper.id}>
                    <PaperCard paper={paper} />
                    {paper.reasoning && (
                      <p className="mt-1.5 text-[11px] font-mono text-red-400/55 italic leading-relaxed">
                        {paper.reasoning}
                      </p>
                    )}
                  </div>
                ))}
                {contradicts.length === 0 && status === 'done' && (
                  <p className="text-sm font-mono text-white/25 italic">No contradicting papers found</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Neutral — below the fold */}
        {neutral.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-neon-red/15">
              <MinusCircle size={18} className="text-neon-red/35" />
              <h2 className="text-base font-mono text-neon-red/35">
                Neutral / Unclear ({neutral.length})
              </h2>
            </div>
            <div className="grid gap-4">
              {neutral.map(paper => (
                <PaperCard key={paper.id} paper={paper} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state after done */}
        {status === 'done' && results.length === 0 && (
          <div className="text-center py-24 font-mono text-white/25 text-sm">
            No papers found for this claim. Try rephrasing or broadening your search terms.
          </div>
        )}

      </main>
    </>
  );
}
