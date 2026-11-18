# Attack logging

Two free sinks, both configured in `wrangler.jsonc`. No paid product involved.

| sink | what | retention | quota (free) |
|---|---|---|---|
| **Workers Logs** (`observability.enabled`) — **active** | every `console.log`, incl. the JSON emitted by `log/attack-log.ts` | 3 days | 200k events/day |
| **Analytics Engine** (`ATTACK_LOG`) — **optional, needs dashboard enable** | one data point per recorded request | 90 days | 100k points/day, 10k queries/day |

Workers Logs carries the full record (ip, ua, path, country, org, decision) and is enough for triage. Analytics Engine adds 90-day retention and SQL; the deploy fails with `code: 10089` until it is switched on at dash.cloudflare.com → Workers & Pages → Analytics Engine → Enable. After that, re-add the `analytics_engine_datasets` block to `wrangler.jsonc` (binding `ATTACK_LOG`, dataset `arxivexplorer_requests`) and redeploy — no code change needed.

`logAttack()` in `log/attack-log.ts` writes both. It never throws, and it is a no-op when the binding is absent (tests, local dev).

## Record layout (query contract)

`index1` = client IP (max 96 bytes). Used for per-IP lookups.

| column | field |
|---|---|
| `blob1` | ip |
| `blob2` | method |
| `blob3` | path + query string (max 300 chars) |
| `blob4` | user-agent (max 200 chars) |
| `blob5` | country (`request.cf.country`) |
| `blob6` | ASN (`request.cf.asn`) |
| `blob7` | AS organisation (`request.cf.asOrganization`) |
| `blob8` | colo (`request.cf.colo`) |
| `blob9` | decision |
| `double1` | response status |
| `double2` | bot score (blocked paths only) |
| `double3` | per-IP request count in the 60s window |
| `double4` | middleware latency, ms |

`decision` values: `blocked_ip`, `bot_burst`, `bot_ua`, `ts_challenge`, `rate_429`, `daily_429`, `image_404`, `ok_sample`.

Blocked/paced/challenged requests are always written. Normal traffic is sampled at 2% (`Math.random() < 0.02` at the end of `middleware.ts`) to stay inside the 100k/day AE quota. `/api/ingest` and prefetch drops are not logged (volume, no investigative value).

`tests/unit/attack-log.test.ts` pins this column order — reordering blobs breaks every query below.

## Reading it in the dashboard

Workers & Pages → `arxivexplorer` → Observability → Logs. Fields are indexed automatically because the log line is JSON. Filter example: `decision = "bot_burst"`.

Logs older than 3 days are gone. Use Analytics Engine for anything historical.

## Reading it with SQL

Token: dash.cloudflare.com → My Profile → API Tokens → Create Token → **Account Analytics : Read**. Account ID: `654138bf69495500265ef8536b778244`.

```bash
CF_TOKEN=...   # Account Analytics:Read
ACCT=654138bf69495500265ef8536b778244

ae() {
  curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCT/analytics_engine/sql" \
    -H "Authorization: Bearer $CF_TOKEN" --data "$1"
}
```

Top IPs, last 24h:

```bash
ae "SELECT blob1 AS ip, blob5 AS country, blob7 AS org, count() AS hits
    FROM arxivexplorer_requests
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    GROUP BY ip, country, org ORDER BY hits DESC LIMIT 25"
```

Decision mix (what actually fired):

```bash
ae "SELECT blob9 AS decision, count() AS n
    FROM arxivexplorer_requests
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    GROUP BY decision ORDER BY n DESC"
```

Everything a single IP did, newest first:

```bash
ae "SELECT timestamp, blob2 AS method, blob3 AS path, blob4 AS ua,
           blob8 AS colo, blob9 AS decision, double1 AS status, double3 AS window_count
    FROM arxivexplorer_requests
    WHERE index1 = '198.51.100.210' AND timestamp > NOW() - INTERVAL '7' DAY
    ORDER BY timestamp DESC LIMIT 200"
```

Burst timeline (per hour) during an incident:

```bash
ae "SELECT toStartOfHour(timestamp) AS hour,
           countIf(blob9 = 'bot_burst') AS bursts,
           countIf(blob9 = 'rate_429') AS paced,
           countIf(blob9 = 'daily_429') AS daily_cap,
           countIf(blob9 = 'ok_sample') AS sampled_ok
    FROM arxivexplorer_requests
    WHERE timestamp > NOW() - INTERVAL '2' DAY
    GROUP BY hour ORDER BY hour"
```

Hosting providers driving the traffic:

```bash
ae "SELECT blob7 AS org, blob6 AS asn, count() AS hits
    FROM arxivexplorer_requests
    WHERE timestamp > NOW() - INTERVAL '24' HOUR AND blob9 != 'ok_sample'
    GROUP BY org, asn ORDER BY hits DESC LIMIT 20"
```

Paths being scanned:

```bash
ae "SELECT blob3 AS path, count() AS hits
    FROM arxivexplorer_requests
    WHERE timestamp > NOW() - INTERVAL '24' HOUR AND blob9 = 'bot_ua'
    GROUP BY path ORDER BY hits DESC LIMIT 30"
```

## Quota notes

- A 100k-request day writes ~100k AE points only if every request is a decision; with 2% sampling of normal traffic, a busy-but-clean day is ~2k points.
- Under an attack the decision count can exceed 100k/day and later points are dropped by the free tier — Workers Logs (200k/day) is the backup for the tail of the incident.
- `1027` day (account request cap) is not a logging problem: middleware never runs, so neither sink records anything. Numbers for those days come from the GraphQL `workersInvocationsAdaptive` dataset, which has no path/IP dimensions.
