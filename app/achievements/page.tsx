'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Navbar } from '../components/Navbar';
import { getAchievements, getActivityStats } from '@/lib/achievements';
import type { AchievementEntry } from '@/lib/achievements';
import { Award, BookOpen, Flame, Star } from 'lucide-react';

const TIER_STYLES: Record<string, string> = {
  bronze: 'border-amber-700/40  bg-amber-900/20  text-amber-300/90',
  silver: 'border-slate-500/40  bg-slate-700/20  text-slate-300/90',
  gold:   'border-yellow-500/50 bg-yellow-900/20 text-yellow-300/90',
};

const TIER_LOCK_STYLES: Record<string, string> = {
  bronze: 'border-amber-900/25  bg-amber-950/20  text-amber-700/40',
  silver: 'border-slate-700/25  bg-slate-800/20  text-slate-600/40',
  gold:   'border-yellow-900/25 bg-yellow-950/20 text-yellow-700/40',
};

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<AchievementEntry[]>([]);
  const [stats, setStats] = useState({ papersRead: 0, topicsVisited: 0, currentStreak: 0, unlockedCount: 0, totalBadges: 0 });

  useEffect(() => {
    setAchievements(getAchievements());
    setStats(getActivityStats());
  }, []);

  const unlocked = achievements.filter(a => a.unlockedAt);
  const locked   = achievements.filter(a => !a.unlockedAt);

  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto w-full px-4 py-10 flex-1">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">Achievements</span>
        </nav>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-full border border-neon-red/30 bg-neon-red/5
            flex items-center justify-center flex-shrink-0">
            <Award size={20} className="text-neon-red/50" />
          </div>
          <div>
            <h1 className="text-xl font-mono font-bold text-white/90">Achievements</h1>
            <p className="text-xs text-neon-red/40 font-mono mt-0.5">
              {stats.unlockedCount} / {stats.totalBadges} unlocked
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="border border-neon-red/15 rounded-xl p-3 bg-[rgba(10,10,10,0.5)]">
            <div className="flex items-center gap-1.5 mb-1">
              <BookOpen size={11} className="text-neon-red/40" />
              <span className="text-[9px] font-mono text-neon-red/40 uppercase tracking-widest">Papers read</span>
            </div>
            <span className="text-2xl font-mono font-bold text-white/80">{stats.papersRead}</span>
          </div>
          <div className="border border-neon-red/15 rounded-xl p-3 bg-[rgba(10,10,10,0.5)]">
            <div className="flex items-center gap-1.5 mb-1">
              <Star size={11} className="text-neon-red/40" />
              <span className="text-[9px] font-mono text-neon-red/40 uppercase tracking-widest">Topics visited</span>
            </div>
            <span className="text-2xl font-mono font-bold text-white/80">{stats.topicsVisited}</span>
          </div>
          <div className="border border-neon-red/15 rounded-xl p-3 bg-[rgba(10,10,10,0.5)]">
            <div className="flex items-center gap-1.5 mb-1">
              <Flame size={11} className="text-amber-500/50" />
              <span className="text-[9px] font-mono text-neon-red/40 uppercase tracking-widest">Day streak</span>
            </div>
            <span className="text-2xl font-mono font-bold text-white/80">{stats.currentStreak}</span>
          </div>
        </div>

        {/* Unlocked badges */}
        {unlocked.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest mb-4">
              Unlocked
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {unlocked.map(a => (
                <BadgeCard key={a.id} achievement={a} unlocked />
              ))}
            </div>
          </section>
        )}

        {/* Locked badges */}
        {locked.length > 0 && (
          <section>
            <h2 className="text-xs font-mono font-bold text-neon-red/20 uppercase tracking-widest mb-4">
              Locked
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {locked.map(a => (
                <BadgeCard key={a.id} achievement={a} unlocked={false} />
              ))}
            </div>
          </section>
        )}

        {achievements.length === 0 && (
          <div className="text-center py-16 text-neon-red/30 font-mono text-sm">
            Start reading papers to unlock achievements.
          </div>
        )}
      </main>
    </>
  );
}

function BadgeCard({ achievement, unlocked }: { achievement: AchievementEntry; unlocked: boolean }) {
  const styles = unlocked ? TIER_STYLES[achievement.tier] : TIER_LOCK_STYLES[achievement.tier];
  return (
    <div className={`border rounded-xl p-4 ${styles} ${unlocked ? '' : 'opacity-50'}`}>
      <div className="text-3xl mb-2 leading-none">{unlocked ? achievement.icon : '🔒'}</div>
      <p className={`text-xs font-mono font-bold leading-snug mb-1 ${unlocked ? '' : 'text-white/20'}`}>
        {achievement.label}
      </p>
      <p className={`text-[10px] font-mono leading-relaxed ${unlocked ? 'opacity-70' : 'text-white/15'}`}>
        {achievement.description}
      </p>
      {unlocked && achievement.unlockedAt && (
        <p className="text-[9px] font-mono mt-2 opacity-40">
          {new Date(achievement.unlockedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
