# Changelog

All notable changes to ArxivExplorer are documented in this file.

**Version:** 1.4.0  
**Development Period:** June 7, 2026  
**License:** BSL 1.1 (converts to MIT on 2029-06-01)

---

## [Unreleased] — Post-mortem: D1 free-tier row-read exhaustion (2026-09-23)

**Status: diagnosis complete. Remediation NOT implemented — no code was changed
for this entry.** Reader-friendly version:
[README → Post-Mortem](README.md#post-mortem--d1-free-tier-quota-exhaustion-2026-09-23).

### Summary

Every read path of the production API failed, and every page silently degraded to
an empty state ("No papers", "not found"). The database was healthy — the
**account had exhausted Cloudflare's free-tier D1 limit of 5,000,000 rows read per
day**. A second, independent free-tier limit had already been exhausted hours
earlier: **1,000 KV writes per day**.

The rate limiter was blamed first and is *not* the cause: it is deployed and it
works — but it only protects the endpoints that are already cheap. The three
endpoints responsible for the quota exhaustion have **no limiter, no working cache,
and no crawl protection at all**.

### Impact

| Surface | Observed behaviour |
| --- | --- |
| `/api/topics`, `/api/stats`, `/api/sitemap` | `HTTP 500` — `D1_ERROR: ... exceeded D1's free tier daily row read limit` |
| `/api/search` | `HTTP 200` but `{"papers":[],"degraded":true}` + `keyword_search_failed` / `semantic_d1_fetch_failed` warnings |
| `/`, `/explore`, `/paper/*`, `/topic/*` | `HTTP 200` but rendered empty (pages catch the API error and show empty state) |
| `/sitemap.xml` | Emitted only the 3 static URLs — topic URLs missing because `getTopics()` threw |

No data loss. Quota resets automatically at midnight UTC.

### Root cause

Unbounded D1 row reads on three publicly reachable, **unmetered** endpoints, with
the cache layer disabled, driven by crawler traffic.

Measured against the 2026-09-21 remote snapshot (17,011 `papers`, 6,686
`summaries`, 75,679 `related_papers`, 25 `topics`), a single cold `/api/topics`
call issues 25 separate FTS `COUNT(DISTINCT p.id)` queries over
`papers_fts ⨝ papers ⨝ summaries`. Those 25 `MATCH` clauses match **145,550 rows in
total**; each row is then visited again through the joins and the
`json_array_length(s.key_contributions) > 0` filter — on the order of
**400,000+ rows read for one request**. At 5M rows/day, roughly **12 such calls
exhaust the entire daily budget**.

**Confirmed against production telemetry** — Cloudflare D1 query insights
(`npx wrangler d1 insights arxiv-explorer --sort-type=sum --sort-by=reads --timePeriod=7d`):

| # | Query shape | Rows read (7 d) | Avg / call | Calls (7 d) | Source |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | `SELECT COUNT(DISTINCT p.id) ... FROM papers_fts f JOIN papers p ...` | **42,226,877** | 1,798 | **23,477** | `getTopicsWithPapers` → `/api/topics`, `/api/stats`, `/sitemap.xml` |
| 2 | `SELECT p.id, p.title, ... FROM papers ... INNER JOIN summaries ...` (batch fetch) | **20,807,124** | 1,741 | 11,947 | `getPapersByIds` / trending |
| 3 | `SELECT COUNT(*) AS total FROM papers WHERE summary_ready = 1` | **8,138,676** | 1,528 | 5,326 | `/api/stats` badge (`stats.ts:32`) |
| 4 | `SELECT ... FROM papers p INNER JOIN summaries s ... ORDER BY p.indexed_at DESC` | 1,269,485 | 5,495 | 231 | `getAllPaperIds` → `/api/sitemap` |
| 5 | `... papers_fts MATCH ? ... ORDER BY bm25(...) LIMIT ?` | 702,355 | 9,241 | 76 | `/api/search` |

**Total across the 20 tracked query shapes: 80,795,850 rows read in 7 days ≈
11.5 million/day, against a 5 million/day limit.** The workload does not spike into
the limit — it runs at a **sustained ~2.3× the entire free-tier budget**, and the top
three shapes are **88 %** of it (42.2 M + 20.8 M + 8.1 M out of 80.8 M).

That also answers "why now": Cloudflare began **enforcing** the free-tier daily row
limits on **2026-09-01** — *"Beginning September 1, 2026, D1 queries on the Workers
Free plan will fail when an account exceeds the daily row read or row write limits.
Queries via the Workers Binding API and the REST API will return errors until the
limit resets at midnight UTC"* (Cloudflare changelog). The read cost predates that
date; enforcement is what turned a silent overrun into an outage. **Without reducing
rows read, this outage is guaranteed to recur every single day.**

### Revised priority (after measuring)

| Fix | Expected saving | Wiring |
| --- | --- | --- |
| Materialize topic counts (P6) | ~4.9 M rows/day (43 %) — removes queries #1 and #4 from the request path | `topics.paper_count` refreshed by cron; `/api/topics` + `/api/stats` + `/sitemap.xml` become one indexed `SELECT`. The cron still pays ~1.1 M/day if it recomputes hourly, ~0.18 M/day every 6 h — move the cost off 3,354 requests/day onto 4–24 cron runs/day. |
| Enable edge caching on the api-worker | ~2.7 M rows/day — most of queries #2, #4, #5 | `jsonResponse()` **already** sends `public, s-maxage=86400, stale-while-revalidate=3600` (`utils.ts:141`) — correct headers, nothing consumes them. `"cache": { "enabled": true }` requires upgrading wrangler: the pinned 4.86.0 schema has no `cache` key (4.136.3 does). Cache hits skip the Worker entirely → zero rows read. |
| Precomputed counter for `/api/stats` (P6) | ~1.2 M rows/day | query #3 runs 761×/day (5,326 per week) to render a badge; replace with a counter row |

Applied together: **~11.5 M → ~2.5 M rows/day**, about half the free-tier budget,
before counting the gains from fixing the `'0.0.0.0'` bucket and adding the limiter
to the three uncovered routes (which is what absorbs the spike days).



### Contributing factors

1. **Three D1-heavy endpoints have no rate limiter.** `withRateLimit` is applied in
   `paper.ts`, `search.ts`, `trending.ts`, `author.ts`, `authors.ts`, `related.ts`,
   `topic.ts` — but **not** in `topics.ts`, `stats.ts`, `sitemap.ts`. Burst test,
   200 parallel requests per endpoint from one IP:
   `/api/search` → 10×200 + **190×429**; `/api/paper/*` → 21×404 + **179×429**;
   `/api/topics`, `/api/stats`, `/api/sitemap` → **127×500 + 0×429**.

2. **`/sitemap.xml` is the single biggest quota consumer.** `app/sitemap.ts` calls
   `getTopics()` on every sitemap fetch. It is the most frequently re-fetched URL on
   any site, it has no `revalidate`, no limiter, and it is not cached.

3. **The KV cache is dead, and the rate limiter is what killed it.**
   `checkRateLimit()` performs `kv.put()` (lines 65, 76, 89) on **every** request
   against a free-tier budget of **1,000 writes/day**. Observed live in
   `wrangler tail`: `KV put() limit exceeded for the day` (4 exceptions, 14 log
   lines), plus `[rate-limit] KV error — falling back to in-memory limiter`.
   The response cache uses the same KV write path, so once writes are exhausted no
   cache entry is ever stored and every request is a full-price D1 miss — the
   limiter starves the very cache that would have prevented the outage.

4. **All server-rendered traffic collapses into a single rate-limit bucket.**
   `helper/api.ts` sends SSR/RSC requests through the `API` service binding to
   `https://api-internal/...` with no `X-Real-IP`, and service-binding subrequests
   carry no `cf-connecting-ip`, so `getClientIP()`
   (`middleware/rate-limit.ts:147-153`) returns `'0.0.0.0'` for **every user and
   every crawler**. `wrangler tail` confirms: 208 direct requests carried
   `x-real-ip: 79.135.105.193`; the `api-internal` requests carried none. Result:
   either legit users are 429'd as soon as bots drain the shared bucket, or (if the
   limit is raised) everyone hits D1 at once.

5. **The rate-limit key is attacker-controlled.** `getClientIP()` prefers the
   `x-real-ip` header, which any caller can set on a `workers_dev = true` endpoint.
   A controlled A/B test (200 requests with 200 unique spoofed `X-Real-IP` values vs
   200 with a single fixed value) measured **30 vs 31 successes** — the spoof bought
   nothing *today* only because the KV limiter it feeds is already dead. It is a
   latent bypass the moment KV recovers.

6. **ISR has never been effective.** `open-next.config.ts:9,21` sets
   `incrementalCache: "dummy"`, so every `export const revalidate` in `app/**/page.tsx`
   is inert, and `helper/api.ts:24,26,29` additionally passes `cache: 'no-store'`.
   Commit `86cb7c0` ("paper pages from force-dynamic to ISR with 1-hour
   revalidation") therefore never took effect. `app/explore/page.tsx:11` is
   `force-dynamic` and fans out to `getStats() + getTopics() + getTrendingPapers()`.

7. **Crawlers were explicitly invited into the unmetered endpoints.**
   `app/robots.ts:12-16` gives `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Applebot` and
   `cohere-ai` a bare `allow: '/'`; per the robots.txt specification the most specific
   agent group **replaces** the `*` group, so the `Disallow: /api/` on line 9 does not
   apply to them. `app/llms.txt/route.ts` then publishes direct links to
   `.../api/topics`, `.../api/search?q=` and `.../api/trending`. The api-worker's own
   `/robots.txt` is Cloudflare's default and restricts nothing.

### Evidence (2026-09-23)

```
GET /api/stats  → 500 {"error":"Database error: D1_ERROR: Your account has exceeded
                  D1's free tier daily row read limit. ... (midnight UTC)"}
GET /api/search?q=transformer → 200 {"papers":[],"total":0,"degraded":true,
                  "warnings":["keyword_search_failed: ...","semantic_d1_fetch_failed: 30 paper(s) dropped..."]}
GET /           → 200, renders "No papers"
GET /paper/1706.03762 → 200, renders "error" / "not found"
GET /sitemap.xml → 200, 3 static URLs only

$ npx wrangler versions view <latest> --config wrangler.api.toml
env.RATE_LIMITER (120 requests/60s)   Rate Limit     ← the 2026-09-21 fix IS live

$ npx wrangler tail --config wrangler.api.toml --format json
exception: Error :: KV put() limit exceeded for the day.
log: ['[rate-limit] KV error — falling back to in-memory limiter:', 'Error: KV put() limit exceeded for the day.']
log: ['[topics] D1 error:', ...] / ['[stats] D1 error:', ...] / ['[sitemap] D1 error:', ...]
request origin: https://api-internal/api/search  (service binding, no client IP)
```

### Why the previous bot mitigations did not work

| Date | Commit | Attempt | Why it missed |
| --- | --- | --- | --- |
| 2026-06-04 | `86cb7c0` | "optimize for AI crawlers": ai.txt/llms.txt, allow all AI bots, paper pages → ISR | Invited the crawlers, advertised the raw JSON API, and the ISR half was inert (dummy cache) |
| 2026-06-06 | `7c53d9c` | Rate limiting on `claim`/`paper`/`search`/`trending` | The three expensive read routes were not in scope |
| 2026-06-06 | `8c6fa5e` | `X-Real-IP` forwarding + namespaced keys | Created both the spoofable key and the `0.0.0.0` collapse for service-binding traffic |
| 2026-06-15 | `d4c7c98` | "perf: parallelize topic paper counts" | Kept the N+1 `COUNT(DISTINCT)` shape; increased concurrent row reads |
| 2026-06-15 | `2f93335` | `withRateLimit` wrapper refactor | No route coverage change |
| 2026-09-21 | `d10688d` | Native `RATE_LIMITER`, fail-closed on KV errors, wrapped `author`/`authors`/`related`/`topic` | Still no `topics`/`stats`/`sitemap`; KV limiter still burns a write per request |

`git log -- src/api-worker/routes/{topics,stats,sitemap}.ts` shows those files were
**never touched by any rate-limit commit** — every mitigation targeted routes the
crawlers do not hammer.

### Remediation plan (proposed — not implemented)

Ordered by impact/effort. P1–P3 + P5 + P7 are small and low-risk; P4/P6/P8 are the
durable fix.

- **P1 — Meter the three holes.** Wrap `handleTopics`, `handleStats`, `handleSitemap`
  in `withRateLimit(..., env.RATE_LIMITER)` (pattern: `topic.ts:20-27`).
  Suggested: `topics` 20/min, `stats` 20/min, `sitemap` 5/min.
- **P2 — Fix identity + the shared bucket.** In `getClientIP()` use
  `cf-connecting-ip` only, and map "no CF header" (internal service-binding traffic)
  to its own bucket (`'internal'`) instead of `'0.0.0.0'`. Never trust `X-Real-IP`
  on a publicly reachable worker; if `/api/classify-claim` needs the end-user IP,
  forward it behind a shared secret known to both workers.
- **P3 — Stop the KV write burn (highest leverage).** The native `RATE_LIMITER`
  binding costs zero KV writes: when it returns `success: true`, call the handler
  without touching the KV counter. Better still, cache the hot read endpoints in the
  Cache API (`caches.default`) — per-colo, no KV, no quota.
- **P4 — Make caching real.** Replace `incrementalCache: "dummy"` in
  `open-next.config.ts`, and drop `cache: 'no-store'` in `helper/api.ts` in favour of
  `next: { revalidate: N }`.
- **P5 — Stop inviting crawlers.** Add `disallow: ['/api/']` to every AI-crawler rule
  in `app/robots.ts`; remove the "Machine-readable endpoints" block from
  `app/llms.txt/route.ts`; remove `getTopics()` from `app/sitemap.ts` and serve topic
  URLs from a cron-maintained list.
- **P6 — Remove the N+1 amplification.** Materialize topic counts into a table/column
  refreshed by the existing hourly cron so `topics.ts`/`stats.ts` become one small
  `SELECT` (~400k → ~25 rows read). Stopgap: Cache API with a 24 h TTL.
- **P7 — `trending.ts:67` queries D1 on every request even on a KV hit.** Move the
  staleness guard to the cron.
- **P8 — Resilience: serve the DB when D1 is unavailable.** `public/data/` is empty
  while `backup/arxiv-explorer-20260921T011532Z.sqlite.xz` holds a full snapshot.
  Export the public subset to JSON assets and fall back to it on `D1_ERROR` so the
  site keeps serving papers during a quota outage.

### Detection / runbook

```bash
# Is the quota gone?
curl -s https://arxiv-api.arxivexplorer.workers.dev/api/stats | head -c 300

# Live traffic, origins and errors (KV quota, D1 quota, who is calling)
npx wrangler tail --config wrangler.api.toml --format=pretty

# What is actually deployed (bindings + limits)
npx wrangler deployments list --config wrangler.api.toml --name arxiv-api
npx wrangler versions view <version-id> --config wrangler.api.toml
```

Symptom to recognise: pages return **HTTP 200 with empty content**. The empty state
is produced by the page-level `catch` in `app/page.tsx` / `app/explore/page.tsx`, so
the HTTP status alone will not reveal this outage — check the rendered body or
`/api/stats`.

---

## [Unreleased] — Implemented: D1 quota-outage remediation (2026-09-23)

Implements the P1–P7 fixes from the post-mortem remediation plan above. Expected
effect: **~11.5 M → ~2.5 M rows read/day**, about half the 5 M/day free-tier
budget (measured with Cloudflare's query insights; re-measure after deploy with
`wrangler d1 insights arxiv-explorer --sort-type=sum --sort-by=reads --timePeriod=1d`).

### What changed

- **L1 — Materialized topic counts** (`0017_topic_paper_counts.sql`,
  `getTopicsWithPapers`, `refreshTopicCounts`). `/api/topics`, `/api/stats` and
  `/sitemap.xml` read `topics.paper_count` instead of 25 live FTS count joins.
  Recomputed by the ingest cron: forced on runs that summarised papers, clocked
  to ≤1 run / 6 h otherwise. Validated locally against the 114 MB production
  snapshot: 25 topics, **identical order and counts**, 0.1 ms vs 409 ms (3,350×).
- **L3 — Aggregate counters** (`counters` table, `getAggregateCounts`). The
  `/api/stats` badge no longer runs `SELECT COUNT(*) … WHERE summary_ready = 1`
  (8.1 M rows / 7 days) per request.
- **L4 — Rate limiting that costs zero KV writes.** `withRateLimit` now approves
  via the native `RATE_LIMITER` binding first and returns without touching KV;
  the key is `${namespace}:${ip}` so each route keeps its own counter. The KV
  sliding window remains as the fallback when the binding is absent (local dev).
  `topics` / `stats` / `sitemap` are now wrapped (20/20/5 per minute).
- **L2/L4 — Trustworthy identity.** `getClientIP` uses `cf-connecting-ip` only;
  `X-Real-IP` is honoured only with a matching `X-Internal-Auth` secret
  (`INTERNAL_TOKEN`, set on both workers). Service-binding traffic gets its own
  `internal` bucket (5,000/min in-memory ceiling) instead of sharing `'0.0.0.0'`.
  `/api/classify-claim` keeps per-user limits when the token is configured
  (300/min shared bucket until then).

- **L2 — Per-colo edge cache** (`src/api-worker/cache/edge.ts`, Cache API,
  no quota, free). `/api/topics` (1 h), `/api/stats` (1 h), `/api/sitemap` (24 h),
  `/api/trending` (10 min–3 h). Only stable anonymous JSON responses are wrapped
  — search is excluded (must not cache `degraded: true` legs; KV covers it at 2 h),
  paper is excluded (must not freeze `summary_ready = 0` polls), claim is POST.
  Adds `X-Edge-Cache: HIT|MISS` so caching is observable from curl.
- **L5 — Closed crawler surface.** Every `robots.txt` group (incl. all AI crawlers)
  now repeats `Disallow: /api/`; `llms.txt` no longer advertises the raw JSON API;
  `ai.txt` points crawlers to HTML pages; `/sitemap.xml` gains `revalidate = 86400`.
- **L7 — No more silent outage.** All `Database error` responses now go through
  `dbErrorResponse`: a daily-limit rejection returns **503 + `Retry-After` until
  00:00 UTC + `degraded: true`** instead of 500 / "No papers". Real query errors
  keep the previous 500 text.
- **Monitoring/visibility.** `index.ts` wraps `env.DB` in `withRowBudget`
  (logs one warning per request past 5,000 rows read). `checkRateLimit` in-memory
  fallback and the KV path are unchanged for local dev.
- **Bugs fixed along the way.** Pipeline invalidation deleted the stale
  `kv:stats:v2` key while `stats.ts` read v4 — stats were never actually
  invalidated; all derived keys now come from `DERIVED_COUNT_KEYS`.
  `/api/trending` no longer queries D1 on KV hits (freshness is the cron's job).
  `stats.ts` local key bumped to `kv:stats:v5` so no stale v4 payload survives.

### Gatekeeping tests (new, all passing)

- `tests/unit/api-hardening.test.ts` — every route in `index.ts` must be wrapped
  in `withRateLimit`; the expensive query shapes exist only in
  `refreshTopicCounts`; the cron calls it; `trending` has no per-request D1
  staleness query; every robots rule disallows `/api/`; `llms.txt` does not
  advertise the API.
- `tests/unit/rate-limit.test.ts` — `getClientIP` trusts only
  `cf-connecting-ip` (+ authenticated `X-Real-IP`); `withRateLimit` never writes
  KV when the native binding approves (the outage regression); per-route keys.
- `tests/unit/db-budget.test.ts` — budget warnings (exactly once), `isD1QuotaError`,
  `secondsUntilQuotaReset`, 503/degraded responses.
- Full suite: `npm test` → **10 files, 179 assertions, all green**.
  `npx tsc --noEmit` → only the 14 pre-existing `revisions.test.ts` errors (baseline
  fails identically — verified with the work stashed).

### Deploy checklist (do this in order)

1. **Migrate D1 first** — `0017_topic_paper_counts.sql` is ADD-only and must be
   live before the API code, otherwise `getTopicsWithPapers` reads a column that
   does not exist and `/explore` renders zero topics:
   ```bash
   npx wrangler d1 execute arxiv-explorer --remote --file=migrations/0017_topic_paper_counts.sql
   ```
   Backfill once right after (the first cron run does it anyway, this avoids a
   one-hour window of empty counts; needs a configured wrangler — otherwise let
   the next cron tick do it):
   ```bash
   curl -X POST https://<ingest-worker>/trigger  # or wait for the hourly cron
   ```
2. **Set the shared secret on both workers** (optional but recommended for per-user
   claim limits):
   ```bash
   wrangler secret put INTERNAL_TOKEN --config wrangler.api.toml
   wrangler secret put INTERNAL_TOKEN --config wrangler.jsonc
   ```
3. **Deploy:**
   ```bash
   npm run deploy:api && npm run deploy:ingest && npm run deploy
   ```
4. **Verify:** `curl -sI https://arxiv-api.arxivexplorer.workers.dev/api/topics`
   should show `X-Edge-Cache: MISS` then `HIT`; burst `/api/topics` must 429 past
   20/min; `wrangler d1 insights arxiv-explorer --sort-type=sum --sort-by=reads
   --timePeriod=1d` must show the topic-count shape gone from the top.

### Still open (not in this change)

- **Workers Cache** (`"cache": { "enabled": true }`): real request collapsing +
  tiered cache. Pinned wrangler 4.86.0 rejects the key — needs the upgrade, then
  verify `Cf-Cache-Status: HIT` on workers.dev before relying on it.
- **ISR**: `open-next.config.ts` still on `incrementalCache: "dummy"`; every
  `export const revalidate` is inert and `helper/api.ts` fetches `no-store`.
- **Custom domain + WAF/rate-limiting rules**: bot defence lives entirely in-worker
  until the site moves off `*.workers.dev` onto its own zone.
- **Static snapshot fallback** during a quota outage (`public/data/` is still
  empty; P8). The 503 + `Retry-After` now at least makes the degraded state
  explicit instead of rendering empty pages with HTTP 200.

<!-- POSTMORTEM-REMEDIATION-2 -->

## [1.4.0] - 2026-06-07

### Refactoring — no functional changes

- **Rate-limit boilerplate extracted** — Removed copy-pasted 20-line rate-limit/429 blocks from `trending.ts`, `search.ts`, and `paper.ts` into a `withRateLimit` middleware helper in `rate-limit.ts`
- **`isPaperComplete` / `isRelatedPaperComplete` deduplicated** — Moved canonical definitions to `src/shared/utils.ts`; `lib/utils.ts` re-exports them; private copies in `db.ts` removed
- **`PAPER_TYPE_LABELS` extracted** — Shared constant moved to `lib/constants.ts`; removed duplicate definitions in `PaperCard.tsx` and `paper/[arxiv_id]/page.tsx`
- **Stale KV guard removed** — `'citationCount' in cached` migration shim in `paper.ts` dropped; all KV entries are now up-to-date

> Rollback: `git revert` to tag `v1.3.0` or revert to commit before this version bump.

---

## [1.3.0] - 2026-06-06

### Added - Discovery Features
- **Follow-up Questions as Search Links** - AI-generated research questions in paper summaries are now clickable search links, enabling direct exploration of related topics
- **Persistent Expertise Slider** - "Undergrad ↔ Researcher" preference is now saved to localStorage and persists across sessions

### Improved - UI/UX
- **Cleaner Search Results** - Removed confusing `(cached)` indicator from search results that could make results appear stale to users

---

## [1.2.0] - 2026-06-05

### Added - Discovery Features
- **Claim Tracking System** - AI-powered claim classification
  - Classify papers as supporting/contradicting/neutral to scientific claims
  - Concurrent classification processing with progress tracking
  - `/claim` route with semantic search integration
  - POST `/api/classify-claim` endpoint using Llama 3.1
- **Abstract Search** - Semantic-only search using pasted abstracts
  - Navbar popover for easy access
  - Direct text-to-embedding search (bypasses keyword search)
  - 2000-character limit for embedding consistency
- **Semantic Quality Gate** - Filter low-relevance search results
  - 70% relative score threshold (drops results below 70% of best match)
  - Top-5 result limit for focused relevance

### Added - Ingestion & Data
- **Neuron Quota Management** - Workers AI free tier optimization
  - Daily quota tracking via KV (5,000 neurons/day)
  - Automatic reset at 00:00 UTC
  - 50% budget reserved for tooltips
- **Minutely Cron Processing** - Granular ingestion pipeline
  - Processes 1 paper per minute (max 113 papers/day)
  - Single retry on failure
  - Replaces hourly batch processing

### Added - UI/UX
- **Cyber-Green Theme** - Cohesive visual identity
  - High-contrast neon-green palette
  - Scanline and radial glow effects on paper cards
  - Staggered entrance animations
- **Enhanced Paper Cards** - Improved interactivity
  - Hover effects with scanline animations
  - Streamlined metadata display

### Security
- **Input Sanitization Module** - Centralized validation (`src/shared/sanitize.ts`)
  - Remove control characters, enforce length limits
  - Prevent injection attacks across all API endpoints
  - Applied to search, claim, paper, author, topic routes
- **Hardened API Endpoints**
  - Constant-time admin secret comparison (timing oracle mitigation)
  - SSRF protection with arXiv ID format validation
  - OOM prevention with bulk insert row caps
  - Strict CORS origin enforcement (no wildcards)
  - Prompt injection protection in claim classification

### Changed
- **Streamlined UI** - Simplified paper metadata display
  - Removed reproducibility badges
  - Removed benchmark/code/concept sections
  - Removed entity tooltips and definitions
  - Cleaner, more focused paper cards
- **Vector ID Normalization** - Standardized Vectorize identifiers
  - Bare paper IDs instead of `paper-{id}` prefixes
  - Hybrid format support in search/related routes
- **Search Result Animations** - Removed stagger-list effect for performance

### Removed
- Deprecated enrichment scripts (non-essential entity extraction)
- Secondary metadata badges from paper cards

---

## [1.1.0] - 2026-06-04

### Added - CLI Tool
- **AI Assistant CLI** (`cli/arxiv-cli.ts`) - Command-line interface for AI assistants
  - Search, paper details, trending, topics, author queries
  - Clean structured output optimized for AI parsing
  - Built and tested with TypeScript

### Added - UI Features
- **Paper Diff/Revisions** - View revision history for updated papers
  - New `/diff/[id]` route showing version comparison
  - "Revisions" button on paper pages when revised_at differs
- **Playlist Management** - Client-side paper organization
  - Create/rename/delete playlists
  - Add/remove papers from playlists
  - Full playlist UI at `/playlists`
- **Multi-Paper Comparison** - Side-by-side comparison of up to 6 papers
  - `/compare?ids=id1,id2,...` route with field selector
  - CSV and Markdown export
- **Achievement System** - Gamified user engagement
  - 10+ achievement badges (explorer, researcher, curator, etc.)
  - Toast notifications on unlock
  - `/achievements` page with progress tracking
- **Enhanced Search Filters** - Advanced filtering capabilities
  - Author substring search
  - Minimum citation count
  - Category filtering
  - Date range (day/week/month)

### Added - Data & Backend
- **Summary Enrichment (Phase 2)** - 1,778/1,778 papers enriched
  - Paper type classification (empirical, theoretical, survey, etc.)
  - Keywords extraction
  - Prerequisites identification
  - Novelty descriptions
  - Application use cases
- **HuggingFace Papers API** - Replaced dead PapersWithCode API
  - `backfill-pwc.ts` rewritten for HF API
  - Models, datasets, spaces metadata
- **Citation Tracking** - Semantic Scholar integration
  - Hourly cron updates
  - Citation counts stored in papers table
- **RSS Feed** - `/rss.xml` with AI summaries
  - 20 most recent papers
  - 1-hour cache TTL
- **Concept & Institution Routes**
  - `/concept/[name]` - Papers by concept
  - `/institution/[slug]` - Papers by institution

### Performance
- **TF-IDF Similarity Engine** - Related papers computation
  - Pre-computed top-8 neighbors
  - Stored in `related_papers` table
- **Author Search Optimization** - Indexed `authors_normalized` column
  - Fast prefix lookups
  - 11,753 normalized author entries
- **Topic Query Optimization** - Fast path implementation
  - Reduced load time from 30s to <500ms
  - Category-based indexing
- **Cache Performance** - KV caching strategy
  - 188ms average cache hit time
  - 50 req/s throughput under load
  - Separate cache keys per filter combination

### Infrastructure
- **Workers Deployment** - All services on Cloudflare
  - API Worker: `https://arxiv-api.arxivexplorer.workers.dev`
  - Frontend Worker: `https://arxivexplorer.arxivexplorer.workers.dev`
  - Ingest Worker: Hourly cron + daily enrichment
- **Local Processing Pipeline** - Ollama integration
  - `gemma4:e4b` (8B Q4_K_M) for summaries
  - `nomic-embed-text` for embeddings
  - Direct D1 REST API (100x faster than wrangler subprocess)
- **Database** - Cloudflare D1 (SQLite)
  - 1,778 papers indexed
  - 8,000+ related-paper pairs
  - 27 curated topics
  - Full-text search (FTS5)
- **Vector Search** - Cloudflare Vectorize
  - BGE base v1.5 embeddings (768 dimensions)
  - Cosine similarity

### Testing
- **55 Integration Tests** - All passing
  - API endpoints (18 tests)
  - Frontend pages (19 tests)
  - Bug regressions (9 tests)
  - Compare & Explore (9 tests)
- **Stress Testing** - Production load verified
  - 100 concurrent search requests
  - 50 req/s mixed workload
  - 0% error rate

### Documentation
- Complete README with architecture, deployment, troubleshooting
- ROADMAP with phase tracking and progress
- FILTERS_SUMMARY for search capabilities
- CLI_TOOL documentation

### Bug Fixes
- **Search summaries missing** - Fixed `PAPER_SELECT` and `rowToPaper()` to include enrichment columns
- **Authors normalized** - NULL values backfilled for all 1,778 papers
- **Related papers bidirectional** - Implemented correct similarity algorithm
- **Topic queries slow** - Optimized category indexing
- **Enrichment migration** - Applied `0006_enrichment.sql` to remote D1
- **HTML URL parsing** - Fixed attribute order regex for arXiv API
- **Bookmark event dispatch** - Fixed cross-tab and same-page sync
- **Search history nested buttons** - Fixed accessibility with role=button

### Migration Notes
- **0006_enrichment.sql** applied (25 new columns on papers/summaries)
- **authors_normalized** backfilled (11,753 rows)
- **paper_categories** normalized for fast topic queries
- **related_papers** pre-computed (8,000+ pairs)

---

## [1.0.0] - 2026-05-30

### Initial Release
- Basic search functionality (FTS + semantic)
- Paper detail pages with AI summaries
- Topic browsing (27 categories)
- Author pages
- Trending papers
- Related papers (vector similarity)
- Bookmarks (localStorage)
- Export to JSON/BibTeX
- Next.js 16 frontend on Cloudflare Workers
- D1 database with Vectorize search
- Workers AI for summarization

---

**Repository:** https://github.com/Teycir/ArxivExplorer  
**License:** BSL 1.1 → MIT (2029-06-01)  
**Author:** Teycir Ben Soltane
