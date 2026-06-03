/**
 * app/components/ActivityTracker.tsx
 * Roadmap Phase 5 — Client component that silently tracks paper views
 * and fires achievement toasts. Mount once per paper detail page.
 */
'use client';

import { useEffect } from 'react';
import { recordPaperView, getAchievements } from '@/lib/achievements';
import { fireAchievementToast } from './AchievementToast';

interface ActivityTrackerProps {
  paperId: string;
  hasCode: boolean;
  hasBenchmark: boolean;
  influentialCitationCount?: number;
}

export function ActivityTracker({
  paperId,
  hasCode,
  hasBenchmark,
  influentialCitationCount = 0,
}: ActivityTrackerProps) {
  useEffect(() => {
    const newBadgeIds = recordPaperView(paperId, {
      hasCode,
      hasBenchmark,
      isInfluential: influentialCitationCount >= 50,
    });

    if (newBadgeIds.length > 0) {
      const all = getAchievements();
      for (const id of newBadgeIds) {
        const badge = all.find(a => a.id === id);
        if (badge) {
          fireAchievementToast({ id: badge.id, icon: badge.icon, label: badge.label, tier: badge.tier });
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  return null; // renders nothing
}
