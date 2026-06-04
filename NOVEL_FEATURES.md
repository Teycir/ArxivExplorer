# Novel Features Implementation

## 1. Abstract → Paper Reverse Search ✅

**Status:** Complete and ready to deploy

**What it does:**
Paste any abstract or paper text to find similar papers in the index using semantic search. Perfect for prior art search, finding related work, or checking if your idea already exists.

**Implementation:**
- Backend already had `handleAbstractSearch` function
- Added `AbstractSearch` component with collapsible textarea
- Updated `searchPapers` helper to support `embedText` parameter
- Added to search page in 3 states: empty, results, and embedText mode
- Uses existing Vectorize embedding infrastructure

**Files changed:**
- `app/components/AbstractSearch.tsx` (new)
- `app/search/page.tsx` (added component + embedText handling)
- `helper/api.ts` (added embedText param)

**API endpoint:** `GET /api/search?embedText=<text>`

**UI location:** Collapsible widget at top of `/search` page

**Zero infrastructure cost** — reuses existing embedding pipeline

---

## 2. Citation Velocity / Momentum Tracker ✅

**Status:** Complete — requires migration + data collection

**What it does:**
Tracks how fast papers gain citations relative to their age. A 3-month-old paper gaining 50 citations this week shows higher momentum than a 3-year-old paper with 500 total. Surfaces research that's "blowing up" right now.

**Implementation:**
- New `citation_snapshots` table stores historical counts
- Update-citations worker logs snapshot on each update
- `getCitationVelocity()` computes 30-day growth normalized by age
- New `/api/velocity` route with KV cache (1h TTL)
- New `/velocity` page to browse momentum papers

**Files changed:**
- `migrations/0010_citation_snapshots.sql` (new table)
- `src/ingest-worker/update-citations.ts` (snapshot logging)
- `src/shared/db.ts` (getCitationVelocity function)
- `src/api-worker/routes/velocity.ts` (new route)
- `src/api-worker/index.ts` (route registration)
- `helper/api.ts` (getVelocityPapers helper)
- `app/velocity/page.tsx` (new page)

**Formula:**
```
velocity = (current_citations - citations_30_days_ago) / paper_age_days
```

**Deployment steps:**
1. Apply migration: `wrangler d1 migrations apply arxiv-explorer --remote`
2. Wait for citation worker to run (runs hourly)
3. Snapshots accumulate over 30 days
4. Velocity data becomes meaningful after first month

**API endpoint:** `GET /api/velocity?limit=20`

**Page:** `/velocity`

---

## Why These Two?

**Abstract search (#4):**
- 45 minutes of work (actual: ~30 min)
- Zero new infrastructure
- Solves real pain point (prior art search)
- Shareable pitch: "paste your abstract, see what exists"

**Citation velocity (#9):**
- ~2 hours of work (actual: ~90 min)
- One new table + updated cron
- Genuinely unique ranking signal
- Clear audience: people tracking "hot" papers

Both features use **existing data in unexpected ways** — no external APIs, no new dependencies, just clever queries over what you already have.

---

## Testing

### Abstract Search
```bash
# Start dev server
npm run dev

# Navigate to /search
# Click "Find similar papers from text"
# Paste any abstract
# Should see semantically similar papers
```

### Citation Velocity
```bash
# Apply migration
wrangler d1 migrations apply arxiv-explorer --remote --config wrangler.api.toml

# Check table exists
wrangler d1 execute arxiv-explorer --remote --command="SELECT COUNT(*) FROM citation_snapshots"

# Wait for citation worker to run (hourly cron)
# Or trigger manually if you have a test endpoint

# Check API
curl https://arxiv-api.yourdomain.workers.dev/api/velocity

# View page
# Navigate to /velocity
```

**Note:** Velocity requires 30 days of snapshots to show meaningful data. Initial deployment will show empty state with message "citation snapshots are still building".

---

## Next Steps

1. Deploy abstract search (ready now)
2. Apply citation_snapshots migration
3. Let snapshots accumulate for 30 days
4. Consider adding "momentum" sort to existing search/topic pages
5. Add velocity to explore page as new section
6. Consider showing velocity badge on PaperCard for high-momentum papers

---

## Other Ideas from the List

**Quick wins (<2 hours):**
- #3 Reproducibility score (compute from existing fields)
- #6 Author intellectual journey timeline (D3 visualization)
- #8 Terminology decoder tooltips (entity definitions)

**Medium lift (2-4 hours):**
- #1 Claim tracker (AI classification per result)
- #5 Research front detector (FTS on novelty field)
- #10 Problem statement index (new summary field)

**Requires design:**
- #2 Cold start explanation (prerequisite → paper mapping)
- #7 Paper speed dating (client-side taste profiling)

All buildable with existing infrastructure. No external dependencies needed.
