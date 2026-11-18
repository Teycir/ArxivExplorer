'use client';

import { useEffect, useState } from 'react';

export function OfflineSupport() {
  const [quota, setQuota] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'quota-exceeded') setQuota(true);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  if (!quota) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,640px)] -translate-x-1/2 rounded-lg border border-neon-red/40 bg-dark-bg/95 px-4 py-3 text-xs text-neutral-300 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-neon-red">!</span>
        <p className="flex-1">
          Free-tier daily request limit reached, so live compute is paused. Cached pages, the
          RSS snapshot, your bookmarks and local history still work. Search, summaries and
          claim checks resume after 00:00 UTC.
        </p>
        <button
          type="button"
          onClick={() => setQuota(false)}
          className="shrink-0 text-neutral-500 hover:text-white"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
