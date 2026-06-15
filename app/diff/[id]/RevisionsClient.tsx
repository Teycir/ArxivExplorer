'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '../../components/Card';
import { CategoryBadge } from '../../components/CategoryBadge';
import { ArrowLeft, GitCompare, Calendar, FileText, Check, AlertCircle } from 'lucide-react';
import type { PaperWithSummary } from '@/src/shared/types';

export interface ArxivVersionData {
  id: string;          // e.g. "2605.28910v1"
  versionNum: number;  // e.g. 1
  title: string;
  abstract: string;
  submittedAt: string;
  comment: string;
  authors: string[];
}

interface RevisionsClientProps {
  paper: PaperWithSummary;
  versions: ArxivVersionData[];
  errorNotice?: string | undefined;
}

// Word diff algorithm with prefix/suffix optimization
export function wordDiff(oldStr: string, newStr: string) {
  const oldWords = oldStr.split(/(\s+)/);
  const newWords = newStr.split(/(\s+)/);
  
  let prefixCount = 0;
  while (prefixCount < oldWords.length && prefixCount < newWords.length) {
    const ow = oldWords[prefixCount];
    const nw = newWords[prefixCount];
    if (ow !== undefined && nw !== undefined && ow === nw) {
      prefixCount++;
    } else {
      break;
    }
  }
  
  let suffixCount = 0;
  while (suffixCount < oldWords.length - prefixCount && suffixCount < newWords.length - prefixCount) {
    const ow = oldWords[oldWords.length - 1 - suffixCount];
    const nw = newWords[newWords.length - 1 - suffixCount];
    if (ow !== undefined && nw !== undefined && ow === nw) {
      suffixCount++;
    } else {
      break;
    }
  }
  
  const midOld = oldWords.slice(prefixCount, oldWords.length - suffixCount);
  const midNew = newWords.slice(prefixCount, newWords.length - suffixCount);
  
  const diffs: Array<{ value: string; added?: boolean; removed?: boolean }> = [];
  
  // Add prefix
  for (let k = 0; k < prefixCount; k++) {
    const val = oldWords[k];
    if (val !== undefined) {
      diffs.push({ value: val });
    }
  }
  
  // DP on middle part
  if (midOld.length > 0 || midNew.length > 0) {
    const dp: number[][] = Array(midOld.length + 1)
      .fill(0)
      .map(() => Array(midNew.length + 1).fill(0));
      
    for (let i = 1; i <= midOld.length; i++) {
      for (let j = 1; j <= midNew.length; j++) {
        const mo = midOld[i - 1];
        const mn = midNew[j - 1];
        if (mo !== undefined && mn !== undefined && mo === mn) {
          const rowPrev = dp[i - 1];
          const val = rowPrev !== undefined ? rowPrev[j - 1] : 0;
          const rowCurr = dp[i];
          if (rowCurr !== undefined) {
            rowCurr[j] = (val ?? 0) + 1;
          }
        } else {
          const rowPrev = dp[i - 1];
          const rowCurr = dp[i];
          const val1 = rowPrev !== undefined ? rowPrev[j] : 0;
          const val2 = rowCurr !== undefined ? rowCurr[j - 1] : 0;
          if (rowCurr !== undefined) {
            rowCurr[j] = Math.max(val1 ?? 0, val2 ?? 0);
          }
        }
      }
    }
    
    let i = midOld.length;
    let j = midNew.length;
    const midDiffs: Array<{ value: string; added?: boolean; removed?: boolean }> = [];
    
    while (i > 0 || j > 0) {
      const mo = midOld[i - 1];
      const mn = midNew[j - 1];
      
      if (i > 0 && j > 0 && mo !== undefined && mn !== undefined && mo === mn) {
        midDiffs.unshift({ value: mo });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
        if (mn !== undefined) {
          midDiffs.unshift({ value: mn, added: true });
        }
        j--;
      } else {
        if (mo !== undefined) {
          midDiffs.unshift({ value: mo, removed: true });
        }
        i--;
      }
    }
    diffs.push(...midDiffs);
  }
  
  // Add suffix
  for (let k = oldWords.length - suffixCount; k < oldWords.length; k++) {
    const val = oldWords[k];
    if (val !== undefined) {
      diffs.push({ value: val });
    }
  }
  
  return diffs;
}

export function RevisionsClient({ paper, versions, errorNotice }: RevisionsClientProps) {
  // Setup version selections
  const [baseVerNum, setBaseVerNum] = useState<number>(() => {
    if (versions.length > 1) {
      const prev = versions[versions.length - 2];
      return prev !== undefined ? prev.versionNum : 1;
    }
    return 1;
  });
  
  const [compareVerNum, setCompareVerNum] = useState<number>(() => {
    if (versions.length > 0) {
      const latest = versions[versions.length - 1];
      return latest !== undefined ? latest.versionNum : 1;
    }
    return 1;
  });

  const baseVer = useMemo(() => {
    return versions.find(v => v.versionNum === baseVerNum) || versions[0];
  }, [versions, baseVerNum]);

  const compareVer = useMemo(() => {
    return versions.find(v => v.versionNum === compareVerNum) || versions[versions.length - 1] || null;
  }, [versions, compareVerNum]);

  const titleDiff = useMemo(() => {
    if (!baseVer || !compareVer) return [];
    return wordDiff(baseVer.title, compareVer.title);
  }, [baseVer, compareVer]);

  const abstractDiff = useMemo(() => {
    if (!baseVer || !compareVer) return [];
    return wordDiff(baseVer.abstract, compareVer.abstract);
  }, [baseVer, compareVer]);

  const authorDiff = useMemo(() => {
    if (!baseVer || !compareVer) return { removed: [], added: [], unchanged: [] };
    const baseAuthors = baseVer.authors;
    const compareAuthors = compareVer.authors;
    const removed = baseAuthors.filter(a => !compareAuthors.includes(a));
    const added = compareAuthors.filter(a => !baseAuthors.includes(a));
    const unchanged = compareAuthors.filter(a => baseAuthors.includes(a));
    return { removed, added, unchanged };
  }, [baseVer, compareVer]);

  const hasAuthorChanges = authorDiff.removed.length > 0 || authorDiff.added.length > 0;

  if (versions.length === 0) {
    // Fallback if no versions could be loaded
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href={`/paper/${encodeURIComponent(paper.id)}`} className="text-neon-red hover:underline flex items-center gap-1.5 text-xs font-mono font-bold uppercase transition-all">
            <ArrowLeft size={14} /> Back to Paper
          </Link>
        </div>

        <div>
          <h1 className="text-xl font-mono font-bold text-white mb-2">Paper Revision History</h1>
          <p className="text-sm text-neutral-400 font-mono">{paper.title}</p>
        </div>

        <Card>
          <div className="p-6 text-center space-y-4">
            <div className="inline-flex items-center justify-center p-3 bg-neutral-900 border border-neutral-800 rounded-full text-neutral-500 mb-2">
              <AlertCircle size={24} className="text-neon-red/70" />
            </div>
            <p className="text-neutral-300 font-mono text-sm max-w-md mx-auto">
              {errorNotice || "We couldn't retrieve the detailed version history from arXiv at this time."}
            </p>
            <p className="text-xs text-neutral-500 font-mono">
              Published: {new Date(paper.publishedAt).toLocaleDateString()}
              {paper.revisedAt && ` • Revised: ${new Date(paper.revisedAt).toLocaleDateString()}`}
            </p>
            <div className="pt-2">
              <a
                href={`https://arxiv.org/abs/${paper.id.replace(/v\d+$/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-neon-red/10 hover:bg-neon-red/20 
                         border border-neon-red/30 rounded-lg text-sm text-neon-red font-mono 
                         transition-all"
              >
                View on arXiv →
              </a>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Navigation & Info */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-2">
          <Link
            href={`/paper/${encodeURIComponent(paper.id)}`}
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase border border-neon-red/20 text-neon-red/70 hover:text-neon-red hover:border-neon-red/50 hover:bg-neon-red/5 px-3 py-1.5 rounded-lg transition-all"
          >
            <ArrowLeft size={12} /> Back to Paper
          </Link>
          <div className="flex flex-wrap gap-2 pt-2">
            {paper.categories.map((c) => (
              <CategoryBadge key={c} category={c} />
            ))}
          </div>
        </div>
        <div className="text-right font-mono text-xs text-neutral-500">
          <p>Local ID: {paper.id}</p>
          {paper.summary?.modelVersion && (
            <p className="text-neon-red/50">AI Summary: {paper.summary.modelVersion}</p>
          )}
        </div>
      </div>

      {/* Title block */}
      <div>
        <h1 className="text-2xl font-mono font-bold text-white tracking-tight leading-relaxed">
          {paper.title}
        </h1>
        <p className="text-sm text-neutral-400 font-mono mt-2">
          By {paper.authors.join(', ')}
        </p>
      </div>

      {/* Version timeline overview */}
      <Card>
        <div className="p-5 border-b border-neutral-900/60 bg-neutral-950/40">
          <h2 className="text-sm font-mono font-bold text-neon-red flex items-center gap-2">
            <Calendar size={14} /> Revision History Timeline
          </h2>
        </div>
        <div className="divide-y divide-neutral-900/40 font-mono text-xs">
          {versions.map((v) => {
            const isCurrentInDB = paper.id.endsWith(`v${v.versionNum}`) || (v.versionNum === 1 && !paper.id.includes('v'));
            return (
              <div
                key={v.id}
                className={`p-4 flex flex-col md:flex-row md:items-start gap-3 transition-colors ${
                  isCurrentInDB ? 'bg-neon-red/5' : 'hover:bg-neutral-950/20'
                }`}
              >
                <div className="flex items-center gap-2 md:w-32 shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    isCurrentInDB ? 'bg-neon-red text-black' : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
                  }`}>
                    v{v.versionNum}
                  </span>
                  <span className="text-neutral-500 md:hidden">
                    {new Date(v.submittedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="hidden md:block w-32 shrink-0 text-neutral-400">
                  {new Date(v.submittedAt).toLocaleDateString()}
                </div>
                <div className="flex-1 space-y-1">
                  {v.comment ? (
                    <p className="text-neutral-300 italic">“{v.comment}”</p>
                  ) : (
                    <p className="text-neutral-500 italic text-[11px]">No submitter comment provided.</p>
                  )}
                  {isCurrentInDB && (
                    <span className="inline-block text-[10px] text-neon-red font-bold uppercase tracking-wider">
                      ★ Version indexed in Explorer
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Comparison controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        <div className="md:col-span-5 bg-neutral-950 border border-neutral-900 rounded-xl p-3 flex items-center justify-between gap-4 font-mono text-xs">
          <label className="text-neutral-400 shrink-0">Base Version:</label>
          <select
            value={baseVerNum}
            onChange={(e) => setBaseVerNum(Number(e.target.value))}
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg py-1.5 px-3 text-white outline-none focus:border-neon-red/50 cursor-pointer"
          >
            {versions.map(v => (
              <option key={v.versionNum} value={v.versionNum} disabled={v.versionNum >= compareVerNum}>
                v{v.versionNum} ({new Date(v.submittedAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 flex justify-center text-neutral-500">
          <GitCompare size={20} className="text-neon-red/40 animate-pulse" />
        </div>

        <div className="md:col-span-5 bg-neutral-950 border border-neutral-900 rounded-xl p-3 flex items-center justify-between gap-4 font-mono text-xs">
          <label className="text-neutral-400 shrink-0">Compare Version:</label>
          <select
            value={compareVerNum}
            onChange={(e) => setCompareVerNum(Number(e.target.value))}
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg py-1.5 px-3 text-white outline-none focus:border-neon-red/50 cursor-pointer"
          >
            {versions.map(v => (
              <option key={v.versionNum} value={v.versionNum} disabled={v.versionNum <= baseVerNum}>
                v{v.versionNum} ({new Date(v.submittedAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Diff View Card */}
      {baseVer && compareVer && (
        <Card className="overflow-hidden">
          <div className="p-5 border-b border-neutral-900/60 bg-neutral-950/40 flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold text-white flex items-center gap-2">
              <GitCompare size={14} className="text-neon-red" /> Comparing v{baseVerNum} vs v{compareVerNum}
            </h2>
            <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
              Green = Added • Red = Removed
            </div>
          </div>

          <div className="p-6 space-y-8 font-mono text-xs md:text-sm">
            {/* Title diff */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Title Comparison</h3>
              <div className="p-4 bg-neutral-950/60 border border-neutral-900 rounded-xl leading-relaxed text-sm md:text-base">
                {titleDiff.map((chunk, idx) => {
                  if (chunk.removed) {
                    return (
                      <span key={idx} className="bg-red-500/10 text-red-400 line-through border border-red-500/20 px-0.5 rounded mx-0.5">
                        {chunk.value}
                      </span>
                    );
                  }
                  if (chunk.added) {
                    return (
                      <span key={idx} className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-0.5 rounded mx-0.5">
                        {chunk.value}
                      </span>
                    );
                  }
                  return <span key={idx} className="text-white">{chunk.value}</span>;
                })}
              </div>
            </div>

            {/* Author diff */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Authors Comparison</h3>
              <div className="p-4 bg-neutral-950/60 border border-neutral-900 rounded-xl space-y-2 text-xs">
                {!hasAuthorChanges ? (
                  <p className="text-neutral-400 flex items-center gap-1.5">
                    <Check size={12} className="text-neon-red" /> No author changes.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {authorDiff.removed.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-red-500 border border-red-500/20 bg-red-500/5 px-1.5 py-0.5 rounded shrink-0">Removed:</span>
                        {authorDiff.removed.map((auth, idx) => (
                          <span key={idx} className="text-red-400 line-through">{auth}</span>
                        ))}
                      </div>
                    )}
                    {authorDiff.added.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0.5 rounded shrink-0">Added:</span>
                        {authorDiff.added.map((auth, idx) => (
                          <span key={idx} className="text-emerald-400 font-semibold">{auth}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-neutral-400">
                      <span className="text-[10px] uppercase font-bold text-neutral-500 border border-neutral-800 bg-neutral-900/20 px-1.5 py-0.5 rounded shrink-0">Unchanged:</span>
                      <span>{authorDiff.unchanged.join(', ')}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Submission comments */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">v{baseVerNum} Comment</h3>
                <div className="p-4 bg-neutral-950/60 border border-neutral-900 rounded-xl min-h-[60px] text-xs">
                  {baseVer.comment ? (
                    <p className="text-neutral-300 italic">“{baseVer.comment}”</p>
                  ) : (
                    <p className="text-neutral-500 italic">No comment for this version.</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">v{compareVerNum} Comment</h3>
                <div className="p-4 bg-neutral-950/60 border border-neutral-900 rounded-xl min-h-[60px] text-xs">
                  {compareVer.comment ? (
                    <p className="text-neutral-300 italic">“{compareVer.comment}”</p>
                  ) : (
                    <p className="text-neutral-500 italic">No comment for this version.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Abstract diff */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Abstract Word Diff</h3>
              <div className="p-5 bg-neutral-950 border border-neutral-900 rounded-xl leading-relaxed text-xs md:text-sm whitespace-pre-wrap select-text selection:bg-neon-red/30">
                {abstractDiff.map((chunk, idx) => {
                  if (chunk.removed) {
                    return (
                      <span key={idx} className="bg-red-500/10 text-red-400 line-through border border-red-500/20 px-0.5 rounded mx-0.5">
                        {chunk.value}
                      </span>
                    );
                  }
                  if (chunk.added) {
                    return (
                      <span key={idx} className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-0.5 rounded mx-0.5">
                        {chunk.value}
                      </span>
                    );
                  }
                  return <span key={idx} className="text-neutral-300">{chunk.value}</span>;
                })}
              </div>
            </div>

          </div>
        </Card>
      )}

      {/* External Link */}
      <div className="flex justify-center pt-2">
        <a
          href={`https://arxiv.org/abs/${paper.id.replace(/v\d+$/, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 border border-violet-500/30 text-violet-400/80 rounded-lg hover:border-violet-500/60 hover:text-violet-400 hover:bg-violet-500/5 transition-all text-xs font-mono font-bold uppercase"
        >
          <FileText size={12} /> View Full Version History on arXiv
        </a>
      </div>
    </div>
  );
}
