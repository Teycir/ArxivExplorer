'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

export function VelocityTracker() {
  const [velocity, setVelocity] = useState<number | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('velocity:history');
    if (!stored) return;

    try {
      const history: { timestamp: number; count: number }[] = JSON.parse(stored);
      if (history.length < 2) return;

      // Calculate velocity from last 2 data points
      const latest = history[history.length - 1];
      const previous = history[history.length - 2];
      
      if (!latest || !previous) return;
      
      const days = (latest.timestamp - previous.timestamp) / (1000 * 60 * 60 * 24);
      const papers = latest.count - previous.count;
      
      if (days > 0) {
        setVelocity(Math.round(papers / days));
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch current count and update history
  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then((data: unknown) => {
        if (typeof data !== 'object' || !data || !('totalPapers' in data)) return;
        const { totalPapers } = data as { totalPapers: number };
        
        const now = Date.now();
        const stored = localStorage.getItem('velocity:history');
        let history: { timestamp: number; count: number }[] = stored ? JSON.parse(stored) : [];
        
        const lastEntry = history[history.length - 1];
        // Only add if last entry is >12h old
        if (history.length === 0 || (lastEntry && now - lastEntry.timestamp > 12 * 60 * 60 * 1000)) {
          history.push({ timestamp: now, count: totalPapers });
          // Keep last 7 entries
          if (history.length > 7) history = history.slice(-7);
          localStorage.setItem('velocity:history', JSON.stringify(history));
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  if (velocity === null || velocity === 0) return null;

  return (
    <span className="flex items-center gap-1 text-[9px] text-neon-red/30 font-mono">
      <Activity size={9} />
      +{velocity}/day
    </span>
  );
}
