'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface QuotaNoticeProps {
  /**
   * 'quota'       → the free-tier D1 daily budget is used up (resets 00:00 UTC).
   * 'unavailable' → API is refusing for another reason (rate limit / 5xx). Never
   *                 claims the quota is gone, because we don't know that it is.
   */
  kind?: 'quota' | 'unavailable';
  /** Seconds until the quota resets, as reported by the API (Retry-After). */
  retryAfter?: number;
  /** 'banner' = slim inline strip; 'full' = centred block replacing a results area. */
  variant?: 'banner' | 'full';
  className?: string;
}

/** Next 00:00 UTC — when Cloudflare's free-tier D1 daily counters reset. */
function nextMidnightUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function formatRemaining(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Explicit "the daily database quota is used up" message.
 *
 * Replaces the silent empty states ("0 papers", "No papers", blank index stats)
 * that made a quota outage look like a data problem. Rendering happens on the
 * client so the reset time is shown in the visitor's own timezone.
 */
export function QuotaNotice({ kind = 'quota', retryAfter, variant = 'banner', className = '' }: QuotaNoticeProps) {
  // null until mounted → server and client markup match (no hydration mismatch)
  const [resetAt, setResetAt] = useState<Date | null>(null);
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    const target = retryAfter && retryAfter > 0
      ? new Date(Date.now() + retryAfter * 1000)
      : kind === 'quota' ? nextMidnightUtc() : new Date(Date.now() + 60_000);
    setResetAt(target);

    const tick = () => setRemaining(formatRemaining(target.getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [retryAfter, kind]);

  const localTime = resetAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const body = kind === 'quota' ? (
    <>
      <p className="text-neon-red/80 font-mono text-sm font-bold uppercase tracking-widest">
        Daily quota exhausted, replenishes midnight
      </p>
      <p className="text-white/50 font-mono text-xs max-w-md leading-relaxed">
        ArxivCSExplorer runs on a free database tier, and today&apos;s read budget is used up.
        The papers are safe — search and browsing are paused until the budget resets at
        00:00 UTC{localTime ? ` (${localTime} your time` : ''}
        {remaining ? `, in about ${remaining}` : ''}
        {localTime ? ')' : ''}.
      </p>
    </>
  ) : (
    <>
      <p className="text-neon-red/80 font-mono text-sm font-bold uppercase tracking-widest">
        Temporarily unavailable
      </p>
      <p className="text-white/50 font-mono text-xs max-w-md leading-relaxed">
        The data service isn&apos;t answering right now, so live stats and results can&apos;t be shown.
        This is usually brief — please try again{remaining ? ` in about ${remaining}` : ' shortly'}.
      </p>
    </>
  );

  if (variant === 'full') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col items-center justify-center py-24 gap-3 text-center ${className}`}
      >
        <AlertTriangle size={32} className="text-neon-red/60" aria-hidden />
        {body}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-md border border-neon-red/25 bg-neon-red/[0.04]
        px-4 py-3 text-left ${className}`}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-neon-red/60" aria-hidden />
      <div className="flex flex-col gap-1">{body}</div>
    </div>
  );
}
