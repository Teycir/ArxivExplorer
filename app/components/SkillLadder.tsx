/**
 * app/components/SkillLadder.tsx
 * Roadmap Phase 3 — Prerequisite Skill Ladder.
 *
 * Shows the prerequisites from a paper's summary as an interactive
 * "before reading this, understand…" chain with:
 *   - Search links for each prerequisite
 *   - localStorage-backed progress tracking (checkboxes)
 *   - Mastery badge when all prerequisites are checked
 *
 * Uses only localStorage (no backend required) — zero cost.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, CheckCircle2, Circle, Award } from 'lucide-react';

interface SkillLadderProps {
  paperId: string;
  prerequisites: string[];
  paperTitle: string;
}

const LS_PREFIX = 'arxiv_prereqs:';

function loadProgress(paperId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${paperId}`);
    const arr = raw ? JSON.parse(raw) as string[] : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveProgress(paperId: string, done: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${LS_PREFIX}${paperId}`, JSON.stringify([...done]));
  } catch { /* storage full — silent fail */ }
}

export function SkillLadder({ paperId, prerequisites, paperTitle }: SkillLadderProps) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDone(loadProgress(paperId));
    setMounted(true);
  }, [paperId]);

  function toggle(prereq: string) {
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(prereq)) { next.delete(prereq); } else { next.add(prereq); }
      saveProgress(paperId, next);
      return next;
    });
  }

  const completed = prerequisites.filter(p => done.has(p)).length;
  const allDone   = completed === prerequisites.length;

  return (
    <div className="border border-neon-red/15 rounded-xl p-5 bg-[rgba(10,10,10,0.5)]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neon-red/10">
        <BookOpen size={13} className="text-neon-red/50" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/50">
          Skill Ladder
        </span>
        {mounted && (
          <span className="ml-auto text-[10px] font-mono text-neon-red/30">
            {completed}/{prerequisites.length} understood
          </span>
        )}
      </div>

      {/* Mastery badge */}
      {mounted && allDone && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg border border-amber-500/30
          bg-amber-500/10 text-amber-400/90">
          <Award size={13} />
          <span className="text-xs font-mono">
            You have all prerequisites for <em className="not-italic font-semibold">
              {paperTitle.slice(0, 50)}{paperTitle.length > 50 ? '…' : ''}
            </em>
          </span>
        </div>
      )}

      <p className="text-[10px] font-mono text-white/30 mb-3">
        To understand this paper, make sure you know these concepts first:
      </p>

      {/* Prerequisite list */}
      <ul className="space-y-2">
        {prerequisites.map((prereq, i) => {
          const isChecked = mounted && done.has(prereq);
          return (
            <li key={i} className="flex items-start gap-2.5 group">
              {/* Checkbox */}
              <button
                onClick={() => toggle(prereq)}
                aria-label={isChecked ? `Mark "${prereq}" as not done` : `Mark "${prereq}" as understood`}
                className="mt-0.5 flex-shrink-0 transition-colors"
              >
                {isChecked
                  ? <CheckCircle2 size={14} className="text-green-400/80" />
                  : <Circle size={14} className="text-neon-red/25 group-hover:text-neon-red/50 transition-colors" />
                }
              </button>

              {/* Label + search link */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-xs font-mono transition-colors ${isChecked ? 'text-white/35 line-through' : 'text-white/65'}`}>
                  {prereq}
                </span>
                <Link
                  href={`/search?q=${encodeURIComponent(prereq)}`}
                  className="text-[9px] font-mono text-neon-red/30 hover:text-neon-red/70 transition-colors
                    border border-neon-red/15 hover:border-neon-red/40 rounded-lg px-1.5 py-0.5"
                >
                  find papers →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Progress bar */}
      {mounted && prerequisites.length > 1 && (
        <div className="mt-4 pt-3 border-t border-neon-red/10">
          <div className="h-1 bg-neon-red/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-neon-red/40 rounded-full transition-all duration-500"
              style={{ width: `${(completed / prerequisites.length) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
