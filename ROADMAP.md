# ArxivExplorer Feature Roadmap

**Last Updated:** 2026-06-04 (session 3)

This document tracks planned features and their implementation status.

**Definition of done:** a box is checked only when (1) schema is applied to remote D1,
(2) data is populated, and (3) a live API query confirms the feature returns correct data.
Aspirational types, unrun migrations, and untested UI do not count.

---

## 🚀 **Deployment & Infrastructure**

- [x] API Worker deployed — `https://arxiv-api.arxivexplorer.workers.dev`
- [x] Ingest Worker deployed and running
- [x] Frontend deployed
- [x] 1,736 papers indexed; 1,700 with `summary_ready=1`
- [x] 8,000 related-paper pairs in `related_papers`
- [x] 27 topics seeded in `topics` table
- [ ] Run `./test-stress-production.sh` — performance acceptable
- [ ] Monitor for 24 hours (Cloudflare analytics)
- [ ] Update README.md with screenshots
- [ ] Tag release: `git tag v1.1.0 && git push --tags`

---

## ✅ **What is verified working (API-confirmed, 2026-06-04)**

All 41 integration tests pass (`bash scripts/test-integration.sh`).

### Core paper data
- [x] `GET /api/paper/:id` — returns paper with full base summary (tldr, keyContributions, methods, limitations, beginnerExplain, technicalSummary, generatedAt, modelVersion) ✓
- [x] `GET /api/paper/:id/related` — returns up to 8 related papers with id, title, tldr, similarityScore ✓
- [x] `GET /api/trending?window=week&limit=N` — returns complete papers ordered by indexed_at ✓
- [x] `GET /api/search?q=...` — FTS search returns papers with full summary joined ✓ (fixed session 2)
- [x] `GET /api/topics` — returns `{topics: [...]}` with 27 topics, each with slug, label, categoryTags, paperCount ✓
- [x] `GET /api/topic/:slug` — returns papers for a topic (tested: agents-planning → 20 papers) ✓
- [x] `GET /api/author/:name` — returns author object with papers array and stats ✓
- [x] `authors_normalized` — backfilled for all 1,736 papers (fast indexed author lookups) ✓
- [x] `0006_enrichment.sql` — applied to remote D1; all enrichment columns present on `papers` and `summaries` tables ✓
- [x] `PAPER_SELECT` and `rowToPaper()` — unified to include all enrichment columns; no route has a stale inline SELECT ✓

### Summary enrichment (in progress)
- [x] Backfill script running: `OLLAMA_BASE=http://localhost:11434 npx tsx scripts/backfill-summaries-v2.ts`
- [x] Model: `gemma4:e4b` (local, 8B Q4_K_M, ~5s/paper)
- [ ] **IN PROGRESS** — 100/1,700 summaries enriched as of session start; ~2–2.5 hrs remaining
- [ ] Verify complete: `SELECT COUNT(*) FROM summaries WHERE paper_type IS NOT NULL AND paper_type != 'unknown'` → 1700

---

## ❌ **Dead external APIs — discovered 2026-06-04**

### PapersWithCode REST API — permanently shut down

**Status:** Dead. All requests to `https://paperswithcode.com/api/v1/` return HTTP 302
redirecting to `https://huggingface.co/papers/trending`. The API has been retired and
replaced by HuggingFace's Papers hub.

**Impact:**
- `scripts/backfill-pwc.ts` is broken — every paper returns `SyntaxError: Unexpected token '<'` (HTML redirect body)
- `paper_code` table will remain at 0 rows until the script is rewritten
- `paper_benchmarks` table will remain at 0 rows until the script is rewritten
- `code_count` and `has_benchmark` columns on `papers` will stay 0/false
- The "Code Available" and "Benchmarked" quality badges will not appear

**Verified:** `curl -si "https://paperswithcode.com/api/v1/papers/?arxiv_id=2301.00001"` →
`HTTP/2 302 → location: https://huggingface.co/papers/trending`

**Replacement:** HuggingFace Papers API (`https://huggingface.co/api/papers/{arxiv_id}`)
returns code repos and other metadata. `backfill-pwc.ts` needs to be rewritten to target
this endpoint. Task: rewrite `backfill-pwc.ts` to use HuggingFace Papers API.

---

## 🐛 **Bugs fixed this session (2026-06-04)**

- [x] **0006_enrichment.sql never applied** — all 25 enrichment columns were absent from remote D1. Fixed: migration applied, confirmed via `PRAGMA table_info`.
- [x] **Search returned no summaries** — `PAPER_SELECT` and `rowToPaper()` both omitted enrichment columns; `ftsSearch` had a stale inline SELECT that didn't include them. Fixed: `PAPER_SELECT` unified, `rowToPaper()` maps all fields, `ftsSearch` uses `PAPER_SELECT` directly.
- [x] **Concept and institution routes had stale inline SELECTs** — both `getPapersByConceptName` and `getPapersByInstitution` had their own column lists instead of using `PAPER_SELECT`. Fixed.
- [x] **`authors_normalized` NULL for all 1,736 papers** — `scripts/backfill-authors-normalized.sh` had never been run. Fixed: 11,753 rows written, all papers now have indexed normalized author strings.

---

## 🎯 **Phase 1: Quality Signals**

### Quality Badges
- [x] `QualityBadges.tsx` component built
- [x] `0006_enrichment.sql` applied — columns exist on remote ✓
- [ ] **paper_code: 0 rows** — PWC API is dead; `backfill-pwc.ts` must be rewritten for HuggingFace Papers API before this can be populated
- [ ] **paper_benchmarks: 0 rows** — same blocker
- [ ] Rewrite `backfill-pwc.ts` → target `https://huggingface.co/api/papers/{arxiv_id}`
- [ ] Run rewritten backfill → populates `paper_code`, `paper_benchmarks`, `code_count`, `has_benchmark`
- [ ] Run OpenAlex backfill: `npx tsx scripts/backfill-openalex.ts` — papers currently too new for OpenAlex index; re-run in ~2 weeks when they're indexed
- [ ] Verify via API: `GET /api/paper/:id` → `isOpenAccess`, `codeCount`, `hasBenchmark` non-null and non-zero

### Author Pages
- [x] `GET /api/author/:name` endpoint returns papers + stats ✓
- [x] `authors_normalized` backfilled — fast indexed lookups ✓
- [ ] Author stats enrichment fields (`codeCount`, `openAccCount`, `totalInfluentialCites`, `benchmarkCount`) — all zero until PWC + OpenAlex backfills complete

---

## 🧪 **Phase 2: Summary Enrichment**

| Step | Status |
|---|---|
| Migration file written | ✅ |
| Migration applied to remote D1 | ✅ (2026-06-04) |
| Pipeline writes fields on new papers | ✅ |
| Backfill script written | ✅ |
| UI renders fields when present | ✅ |
| **Backfill running against 1,700 existing rows** | 🔄 IN PROGRESS (~100 done) |
| **API returns enriched fields** | ⏳ pending backfill completion |

**ETA:** ~2–2.5 hours from session start. Model: `gemma4:e4b` local via Ollama, ~5s/paper.

**To verify when done:**
```bash
npx wrangler d1 execute arxiv-explorer --remote --command \
  "SELECT COUNT(*) FROM summaries WHERE paper_type IS NOT NULL AND paper_type != 'unknown'"
# Expect: 1700
```

---

## ~~Phase 3: Visualization & Discovery~~ — **Removed 2026-06-04**

All 3D graph code has been fully removed from the codebase:
- `app/explore/page.tsx` — replaced with a plain index stats page (no graph)
- `app/components/PaperCloudVis.tsx` and `HeroStars.tsx` — deleted
- `src/api-worker/routes/graph.ts` and `/api/graph` route — deleted
- `scripts/cluster-papers-local.ts`, `generate-clusters.ts`, `generate-demo-clusters.ts` — deleted
- `public/data/paper-clusters.json` — deleted
- npm packages `three`, `@react-three/fiber`, `@react-three/drei`, `react-force-graph-2d` — uninstalled

Phase 3 is not planned for reimplementation.

---

## 📚 **Phase 4: Learning & Collaboration**

### Skill Ladder / Prerequisites
- [x] `SkillLadder.tsx` built
- [x] `SummarySection.tsx` renders prerequisites as clickable search links
- [ ] **Blocked by Phase 2** — `prerequisites` column populated only after summary backfill completes

### Paper Playlists
- [ ] Schema, endpoints, UI — not started

---

## 🔄 **Phase 5: Version Control & Comparison**

### Multi-Paper Comparison
- [x] `/compare` page exists with multi-paper matrix
- [ ] Not integration tested

### Paper Diff
- [ ] Not started

---

## 🎮 **Phase 6: Gamification**

### Achievement System
- [x] `lib/achievements.ts` + localStorage tracking built
- [x] `/achievements` page with badge grid
- [x] `AchievementToast.tsx` on badge unlock
- [ ] Leaderboard — deferred (requires backend)

---

## ✍️ **Phases 7–11** (Community, Notifications, Advanced Discovery, Remixing, Analytics)

Not started.

---

## 🛠️ **Immediate action list (ordered)**

1. ✅ ~~Apply `0006_enrichment.sql` to remote D1~~
2. ✅ ~~Fix search route — summaries not returned in search results~~
3. ✅ ~~Run `backfill-authors-normalized.sh`~~
4. 🔄 ~~`npx tsx scripts/backfill-summaries-v2.ts`~~ — **IN PROGRESS**, ~2 hrs left
5. **Rewrite `backfill-pwc.ts`** to use HuggingFace Papers API (PWC is dead)
6. Run rewritten PWC backfill — populates `paper_code`, `paper_benchmarks`, `code_count`, `has_benchmark`
7. Re-run `backfill-openalex.ts` in ~2 weeks — papers too new now, OpenAlex indexes with a delay
8. Verify all quality badge fields non-null via `GET /api/paper/:id`

---

**Progress:** 41/41 integration tests passing. Phase 2 backfill in progress. PWC API dead — needs script rewrite before Phase 1 badges are complete.
