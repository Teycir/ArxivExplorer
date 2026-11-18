/**
 * log/attack-log.ts
 *
 * Per-request attack telemetry. Two sinks, both free-plan:
 *  - console.log(JSON)  -> Workers Logs (dashboard, 3d retention, indexed fields)
 *  - ATTACK_LOG.writeDataPoint() -> Analytics Engine (SQL, 90d retention)
 *
 * Quota math: decisions (403/429/challenge) are always written; normal traffic
 * is sampled by the caller. AE free tier = 100k points/day, Workers Logs = 200k
 * events/day, so a 100k-request day fits with headroom.
 *
 * Never throws: telemetry must not break the request it is instrumenting.
 */

export type Decision =
  | 'ok_sample'
  | 'prefetch'
  | 'image_404'
  | 'blocked_ip'
  | 'bot_ua'
  | 'bot_burst'
  | 'ts_challenge'
  | 'rate_429'
  | 'daily_429';

export interface AttackEvent {
  decision: Decision;
  ip: string;
  method: string;
  path: string;
  ua: string;
  status: number;
  score?: number;
  count?: number;
  ms?: number;
}

interface AnalyticsEngineDatasetLike {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

export interface AttackLogContext {
  env?: { ATTACK_LOG?: AnalyticsEngineDatasetLike };
  cf?: {
    country?: string;
    asn?: number;
    asOrganization?: string;
    colo?: string;
  };
}

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

export function logAttack(context: AttackLogContext | null, event: AttackEvent): void {
  const cf = context?.cf;
  const record = {
    evt: 'req',
    decision: event.decision,
    ip: event.ip,
    method: event.method,
    path: cut(event.path, 300),
    ua: cut(event.ua, 200),
    country: cf?.country ?? '',
    asn: cf?.asn ?? 0,
    org: cut(cf?.asOrganization ?? '', 80),
    colo: cf?.colo ?? '',
    score: event.score ?? 0,
    count: event.count ?? 0,
    status: event.status,
    ms: event.ms ?? 0,
  };

  try {
    console.log(JSON.stringify(record));
  } catch {
    /* ignore */
  }

  const dataset = context?.env?.ATTACK_LOG;
  if (!dataset || typeof dataset.writeDataPoint !== 'function') return;

  try {
    dataset.writeDataPoint({
      // index1 drives per-IP lookups: WHERE index1 = '1.2.3.4'
      indexes: [cut(event.ip || 'unknown', 96)],
      // blob1..blob9
      blobs: [
        record.ip,
        record.method,
        record.path,
        record.ua,
        record.country,
        String(record.asn),
        record.org,
        record.colo,
        record.decision,
      ],
      // double1..double4
      doubles: [record.status, record.score, record.count, record.ms],
    });
  } catch {
    /* ignore */
  }
}
