// app/components/AchievementsWidget.tsx
// Compact homepage widget — reads localStorage, shows streak, progress, badges.

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Award, BookOpen, Flame, Star, ChevronRight } from 'lucide-react';
import { getAchievements, getActivityStats } from '@/lib/achievements';
import type { AchievementEntry } from '@/lib/achievements';
import { Tooltip } from './Tooltip';

// thresholds in ascending order for "next badge" logic
const PAPER_MILESTONES = [1, 10, 50, 100];
const PAPER_LABELS: Record<number, string> = {
  1: 'First Steps', 10: 'Explorer', 50: 'Deep Diver', 100: 'Centurion',
};

export function AchievementsWidget() {
  const [stats, setStats] = useState({
    papersRead: 0, topicsVisited: 0, currentStreak: 0,
    unlockedCount: 0, totalBadges: 0,
  });
  const [unlocked, setUnlocked] = useState<AchievementEntry[]>([]);

  useEffect(() => {
    const s = getActivityStats();
    const a = getAchievements();
    setStats(s);
    setUnlocked(a.filter(x => x.unlockedAt !== undefined));

    // Refresh if activity changes elsewhere in the same tab
    const handler = () => {
      setStats(getActivityStats());
      setUnlocked(getAchievements().filter(x => x.unlockedAt !== undefined));
    };
    window.addEventListener('arxiv:activity-changed', handler);
    return () => window.removeEventListener('arxiv:activity-changed', handler);
  }, []);

  // Progress to next milestone
  const nextTarget = PAPER_MILESTONES.find(m => stats.papersRead < m);
  const prevTarget = nextTarget
    ? (PAPER_MILESTONES[PAPER_MILESTONES.indexOf(nextTarget) - 1] ?? 0)
    : null;
  const progressPct = nextTarget && prevTarget !== null
    ? Math.min(100, ((stats.papersRead - prevTarget) / (nextTarget - prevTarget)) * 100)
    : 100;

  return (
    <div className="border border-neon-red/15 rounded-xl bg-black/20 p-4 flex flex-col gap-4">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={14} className="text-neon-red/50" />
          <h3 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
            Achievements
          </h3>
        </div>
        <Link
          href="/achievements"
          className="flex items-center gap-0.5 text-[10px] font-mono
            text-neon-red/35 hover:text-neon-red/65 transition-colors"
        >
          View all <ChevronRight size={10} />
        </Link>
      </div>

      {/* ── Stats row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: <BookOpen size={11} className="text-neon-red/40" />, value: stats.papersRead,    label: 'papers'   },
          { icon: <Flame    size={11} className="text-amber-500/60" />, value: stats.currentStreak, label: 'day streak' },
          { icon: <Star     size={11} className="text-neon-red/40" />, value: `${stats.unlockedCount}/${stats.totalBadges}`, label: 'badges' },
        ].map(({ icon, value, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-1 p-2 rounded-lg
              border border-neon-red/10 bg-black/30"
          >
            {icon}
            <span className="text-base font-mono font-bold text-white/80 tabular-nums leading-none">
              {value}
            </span>
            <span className="text-[9px] font-mono text-neon-red/30 leading-none">
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Progress to next badge ─────────────────────────────── */}
      {nextTarget && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-neon-red/40">
              {PAPER_LABELS[nextTarget]}
            </span>
            <span className="text-[10px] font-mono text-neon-red/25 tabular-nums">
              {stats.papersRead} / {nextTarget}
            </span>
          </div>
          <div className="h-1 rounded-full bg-neon-red/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, rgba(0,255,65,0.35) 0%, #00ff41 100%)',
                boxShadow: '0 0 6px rgba(0,255,65,0.4)',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Earned badges row ──────────────────────────────────── */}
      {unlocked.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[9px] font-mono text-neon-red/25 uppercase tracking-wider">
            Earned
          </p>
          <div className="flex flex-wrap gap-2">
            {unlocked.slice(0, 7).map(a => (
              <Tooltip key={a.id} content={`${a.label} — ${a.description}`} position="top">
                <span
                  className="text-lg leading-none cursor-default select-none"
                  role="img"
                  aria-label={a.label}
                >
                  {a.icon}
                </span>
              </Tooltip>
            ))}
            {unlocked.length > 7 && (
              <span className="text-[10px] font-mono text-neon-red/30 self-center">
                +{unlocked.length - 7} more
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[10px] font-mono text-neon-red/20 text-center py-1">
          Start reading papers to earn your first badge
        </p>
      )}
    </div>
  );
}
