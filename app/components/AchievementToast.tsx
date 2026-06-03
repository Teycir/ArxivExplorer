/**
 * app/components/AchievementToast.tsx
 * Roadmap Phase 5 — Pops up briefly when a new badge is earned.
 * Renders in a fixed overlay; fades out after 4 s.
 */
'use client';

import { useEffect, useState } from 'react';

interface Toast {
  id: string;
  icon: string;
  label: string;
  tier: 'bronze' | 'silver' | 'gold';
}

const TIER_COLORS: Record<string, string> = {
  bronze: 'border-amber-700/50 bg-amber-900/30 text-amber-300',
  silver: 'border-slate-400/50  bg-slate-700/30  text-slate-200',
  gold:   'border-yellow-400/60 bg-yellow-900/30 text-yellow-300',
};

export function AchievementToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const { icon, label, tier, id } = (e as CustomEvent<Toast>).detail;
      setToasts(prev => [...prev, { id, icon, label, tier }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    }
    window.addEventListener('arxiv:achievement-unlocked', handler);
    return () => window.removeEventListener('arxiv:achievement-unlocked', handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-xl
            font-mono text-xs animate-slide-in-right backdrop-blur-sm
            ${TIER_COLORS[toast.tier]}`}
        >
          <span className="text-lg leading-none">{toast.icon}</span>
          <div>
            <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">Achievement unlocked</p>
            <p className="font-bold text-sm leading-none">{toast.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Call this from anywhere to fire the toast event for a badge. */
export function fireAchievementToast(badge: Toast) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('arxiv:achievement-unlocked', { detail: badge }));
}
