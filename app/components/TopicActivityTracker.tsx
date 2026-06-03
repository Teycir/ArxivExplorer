/**
 * app/components/TopicActivityTracker.tsx
 * Client component: records topic visit for the achievement system.
 * Renders nothing — pure side-effect on mount.
 */
'use client';

import { useEffect } from 'react';
import { recordTopicView, getAchievements } from '@/lib/achievements';
import { fireAchievementToast } from './AchievementToast';

interface TopicActivityTrackerProps {
  slug: string;
}

export function TopicActivityTracker({ slug }: TopicActivityTrackerProps) {
  useEffect(() => {
    const newBadgeIds = recordTopicView(slug);
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
  }, [slug]);
  return null;
}
