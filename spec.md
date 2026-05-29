# arXiv Explorer — Spec v2.0 (Optimized)

> **Tagline:** Fast semantic arXiv explorer with cached AI summaries  
> **Stack:** Next.js · Cloudflare Workers · Cloudflare AI · D1 · KV · Vectorize

---

# Changelog v1 → v2

## Critical fixes (v1 was broken)

| # | Issue | Impact | Fix |
|---|---|---|---|
| C1 | 5 AI prompts per paper blows Workers AI neuron budget **10×** | Free tier supports ~121 papers/day at 5 prompts; spec claimed 50/hour (1,200/day) | Consolidated into 1 structured JSON prompt per paper |
| C2 | KV write budget exceeded: spec claimed ~200 writes/day, reality is 1,600/day | Breaks free tier (1k writes/day limit) | Lazy KV writes on first access; D1 is source of truth |
| C3 | Query embeddings hit Workers AI in user hot path — unacknowledged | Consumes neuron budget during searches, adds ~50ms latency | Cache embeddings in KV by query hash |
| C4 | Related papers queried from Vectorize on every paper detail page | Vectorize in hot path; should be pre-computed | Pre-compute related papers at ingestion time into D1 |

## Significant fixes

| # | Issue | Fix |
|---|---|---|
| S1 | No D1 indexes defined — full table scans as dataset grows | Added 5 composite indexes |
| S2 | Missing `related_papers` table in D1 schema | Added table; Vectorize now only used in ingestion |
| S3 | FTS treats title and abstract equally — title match should rank higher | Added BM25 column weights (10:1:5 title:abstract:authors) |
| S4 | "Vercel or Cloudflare Pages" — split choice creates CORS/latency complexity | Commit to Cloudflare Pages only |
| S5 | Ingestion and API in same Worker — cron heavy work risks CPU timeout | Separate workers: `api-worker` + `ingest-worker` |
| S6 | Unstructured AI output — parsing plain text is fragile | Use `response_format: json_object` structured output |
| S7 | arXiv API rate limits unhandled — will get 429s at 50 papers/cron | Added 3s delay between category fetches; handle 429 with backoff |
| S8 | Serial D1 writes — one INSERT per paper per cron tick | Use `db.batch()` for all D1 writes in a single round trip |

## Minor fixes

| # | Issue | Fix |
|---|---|---|
| M1 | LangGraph mentioned but never used — creates confusion | Removed all LangGraph references |
| M2 | CORS headers absent from Worker routes | Added CORS configuration |
| M3 | Ingestion idempotency strategy not specified | Use `INSERT OR IGNORE` + upsert for revised papers |
| M4 | Rerank weight 0.4/0.6 is arbitrary | Changed to 0.25/0.75 (keyword/semantic) — aligns with research IR best practices |
| M5 | ISR for paper detail pages — papers are immutable | Static generation for all indexed papers; ISR only for fallback on brand-new papers |
| M6 | No sitemap or robots.txt | Added to project structure and Phase 1 checklist |

---

## 1. Product Overview

### 1.1 Vision

A static-first, AI-enhanced search engine for arXiv papers. Not a chatbot. Not a research copilot. A fast, reliable tool that lets any researcher, engineer, or student understand a paper in 60 seconds — without a live LLM call ever hitting the user path.

### 1.2 Design Philosophy

| Principle | Meaning |
|---|---|
| **Cache-first** | Most requests hit a cache, not an LLM |
| **Fast > Smart** | Sub-200ms pages beat 3-second AI wizardry |
| **Precompute everything** | Summaries generated once, served forever |
| **No login required** | Zero friction for discovery |
| **Small outputs** | TL;DRs, bullets, short summaries — not essays |
| **Workers AI is offline-only** | Zero live LLM calls in user-facing paths |

### 1.3 What This Is Not

- Not a conversational AI assistant
- Not a PDF uploader or document processor
- Not a multi-agent reasoning system
- Not a personalized research feed (initially)

---

## 2. User Flows

*(Unchanged from v1 — flows are correct)*

### 2.1 Discovery Flow

```
[Home: single search box]
        ↓
[Search results: ranked cards with TL;DR]
        ↓
[Paper detail: full cached AI summary]
        ↓
[Related papers sidebar]
```

### 2.2 Direct Paper Flow

```
[User pastes arXiv ID or URL]
        ↓
[Redirect to /paper/:arxiv_id]
        ↓
[Full detail page — served from CDN/KV]
```

### 2.3 Topic Browsing Flow

```
[Category page: e.g. /topic/rag-evaluation]
        ↓
[Curated + ranked papers for that topic]
        ↓
[Individual paper detail]
```

---

## 3. Pages & UI Spec

*(Unchanged from v1)*

---

## 4. Architecture

### 4.1 System Diagram

```
Browser
  ↓
Next.js on Cloudflare Pages  ← committed; Vercel removed (CORS, latency, cost)
  ↓
Cloudflare CDN (edge cache — most requests stop here)
  ↓
api-worker (request path only)
  ↓
KV (hot cache: summaries, related papers, search results, query embeddings)
  ↓ cache miss only
D1 (all structured data: metadata, summaries, related_papers, topics)
  ↓ semantic queries in search only (never for related papers)
Vectorize

────────────────────────────────────────────
ingest-worker (cron only — separate Worker)
  ↓
Workers AI (summarization + embedding)
  ↓
D1 + Vectorize
  ↓
KV warm-up for popular papers
────────────────────────────────────────────
```

**Key change from v1:** Two workers, not one.

- `api-worker`: serves user requests; Workers AI is **never called** here
- `ingest-worker`: runs on cron schedule; is the only caller of Workers AI

This separation means:
- API Worker has no CPU budget risk from AI calls
- Ingestion failure never affects the user-facing API
- Each worker can be deployed and scaled independently

---

### 4.2 Cloudflare Worker — API Routes (`api-worker`)

| Route | Description | Cache Layer | TTL |
|---|---|---|---|
| `GET /api/search?q=` | Hybrid search | KV | 2h |
| `GET /api/paper/:id` | Paper metadata + summary | KV → D1 | Permanent |
| `GET /api/paper/:id/related` | Pre-computed related papers | KV → D1 | Permanent |
| `GET /api/topic/:slug` | Topic papers list | KV → D1 | 12h |
| `GET /api/trending` | Trending papers (last 7d) | KV | 60 min |
| `GET /api/author/:name` | Papers by author | KV → D1 | 6h |
| `GET /api/sitemap` | Sitemap XML for SEO | KV | 24h |

**Cache key pattern:**

```
kv:paper:{arxiv_id}:full          ← paper + summary combined (one KV read per page)
kv:paper:{arxiv_id}:related       ← pre-computed at ingestion
kv:search:{sha256(normalized_q)}  ← 2h TTL
kv:embed:{sha256(normalized_q)}   ← query embedding cache, 24h TTL  ← NEW
kv:topic:{slug}                   ← 12h TTL
kv:trending                       ← 60min TTL
```

**CORS headers (all routes):**

```typescript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://arxiv-explorer.pages.dev',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
```

**Cache-Control on all responses:**

```
Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600
```

---

### 4.3 Next.js Frontend (Cloudflare Pages)

| Page | Rendering | Revalidation |
|---|---|---|
| Home (`/`) | ISR | 30 min |
| Search (`/search`) | Client-side | — |
| Paper detail (`/paper/:id`) | Static (popular) + ISR fallback | Never (papers are immutable) |
| Topic (`/topic/:slug`) | ISR | 12h |
| Author (`/author/:name`) | ISR | 6h |

**Change from v1:** Paper detail pages use `generateStaticParams` to pre-render all indexed papers at build time. arXiv papers are immutable — ISR revalidation is unnecessary and wasteful. New papers land via the ISR fallback, then become permanent static.

---

## 5. Data Models

### 5.1 D1 — `papers` table

```sql
CREATE TABLE papers (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  authors       TEXT NOT NULL,       -- JSON array
  abstract      TEXT NOT NULL,
  categories    TEXT NOT NULL,       -- JSON array
  published_at  TEXT NOT NULL,       -- ISO date YYYY-MM-DD
  revised_at    TEXT,
  pdf_url       TEXT,
  html_url      TEXT,
  indexed_at    TEXT NOT NULL,
  summary_ready INTEGER DEFAULT 0    -- 0=pending, 1=ready, 2=failed
);

-- Indexes (ABSENT in v1 — added in v2)
CREATE INDEX idx_papers_published    ON papers(published_at DESC);
CREATE INDEX idx_papers_indexed      ON papers(indexed_at DESC);
CREATE INDEX idx_papers_summary      ON papers(summary_ready, indexed_at DESC);
```

### 5.2 D1 — `summaries` table

```sql
CREATE TABLE summaries (
  paper_id          TEXT PRIMARY KEY REFERENCES papers(id),
  tldr              TEXT NOT NULL,
  key_contributions TEXT NOT NULL,   -- JSON array
  methods           TEXT NOT NULL,   -- JSON array
  limitations       TEXT NOT NULL,   -- JSON array
  beginner_explain  TEXT NOT NULL,
  technical_summary TEXT NOT NULL,
  generated_at      TEXT NOT NULL,
  model_version     TEXT NOT NULL
);
```

### 5.3 D1 — `related_papers` table ← NEW in v2

```sql
-- Pre-computed at ingestion time. Vectorize no longer queried in hot path.
CREATE TABLE related_papers (
  paper_id         TEXT NOT NULL REFERENCES papers(id),
  related_paper_id TEXT NOT NULL REFERENCES papers(id),
  similarity_score REAL NOT NULL,
  rank             INTEGER NOT NULL,  -- 1–8
  computed_at      TEXT NOT NULL,
  PRIMARY KEY (paper_id, related_paper_id)
);

CREATE INDEX idx_related_paper ON related_papers(paper_id, rank);
```

### 5.4 D1 — `embeddings_meta` table

```sql
CREATE TABLE embeddings_meta (
  paper_id      TEXT PRIMARY KEY REFERENCES papers(id),
  vectorize_id  TEXT NOT NULL,
  embedded_at   TEXT NOT NULL
);
```

### 5.5 D1 — `topics` table

```sql
CREATE TABLE topics (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT,
  category_tags TEXT,               -- JSON array of arXiv categories
  updated_at    TEXT NOT NULL
);
```

### 5.6 D1 — Full-Text Search

```sql
CREATE VIRTUAL TABLE papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors,
  content=papers,
  content_rowid=rowid
);

-- Keep FTS in sync
CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
END;

CREATE TRIGGER papers_fts_update AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts SET title=new.title, abstract=new.abstract, authors=new.authors
  WHERE paper_id=new.id;
END;
```

### 5.7 Vectorize Index Schema

```
Index name:      arxiv-papers
Dimensions:      768  (@cf/baai/bge-base-en-v1.5)
Distance metric: cosine

Vector metadata (kept minimal — larger payloads slow queries):
{
  paper_id:     "2312.00752",
  published_at: "2023-12-01",
  categories:   "cs.LG,cs.CL"   ← flat string for Vectorize metadata filtering
}
```

---

## 6. Ingestion Pipeline (ingest-worker)

### 6.1 Neuron Budget Reality

The free tier provides **10,000 neurons/day**.

| Approach | Neurons/paper | Max papers/day |
|---|---|---|
| v1: 5 separate prompts | ~82 | ~121 |
| v2: 1 consolidated prompt | ~44 | ~227 |
| v2: embedding only (no summary) | ~4 | ~2,500 |

**Practical ingestion rate on free tier: 10 papers/hour** (240/day), which leaves headroom for search query embeddings and embedding re-runs.

For production traffic, upgrade to Workers AI paid tier ($0.011/1k neurons). At 10 papers/hour × 5 categories × 24h = 1,200 papers/day × 44 neurons = ~52,800 neurons/day → ~$0.58/day.

### 6.2 Optimized Pipeline Flow

```
[Cron: every hour — ingest-worker]
        ↓
1. Fetch arXiv API — 1 request per category, 3s delay between each
        ↓
2. Filter new papers: SELECT id FROM papers WHERE id IN (...) — batch check
        ↓
3. Batch INSERT papers to D1 using db.batch() ← single round trip
        ↓
4. For each new paper (parallel, max 5 concurrent):
   ├── 4a. Generate embedding → Workers AI (@cf/baai/bge-base-en-v1.5)
   ├── 4b. Upsert to Vectorize
   └── 4c. Generate ALL summary fields → 1 Workers AI call (structured JSON output)
        ↓
5. Batch INSERT summaries to D1 using db.batch()
        ↓
6. For each new paper: query Vectorize top-8 → store in related_papers table
        ↓
7. Batch UPDATE papers SET summary_ready=1 using db.batch()
        ↓
8. Write KV entries ONLY for papers that are already in KV (cache refresh)
   New papers are NOT eagerly written to KV — lazy write on first access
        ↓
9. Invalidate kv:trending (TTL will expire naturally, or explicit delete)
```

**Key change:** Steps 3, 5, 7 use `db.batch()` — all D1 writes for a batch of papers happen in a single HTTP round trip instead of N sequential calls.

### 6.3 arXiv API Fetch with Rate Limiting

```typescript
const CATEGORIES = ['cs.LG', 'cs.CL', 'cs.CV', 'stat.ML'];
const DELAY_MS = 3000; // arXiv asks for 3s between requests

async function fetchArxivBatch(category: string, maxResults = 30): Promise<ArxivPaper[]> {
  const url = `https://export.arxiv.org/api/query` +
    `?search_query=cat:${category}` +
    `&sortBy=submittedDate&sortOrder=descending` +
    `&max_results=${maxResults}`;

  const response = await fetch(url);

  if (response.status === 429) {
    // Back off 60s and retry once
    await delay(60_000);
    return fetchArxivBatch(category, maxResults);
  }

  const xml = await response.text();
  return parseAtomXml(xml);
}

// In cron handler: fetch categories with delay between each
for (const category of CATEGORIES) {
  const papers = await fetchArxivBatch(category);
  await processBatch(papers, env);
  await delay(DELAY_MS);
}
```

### 6.4 Consolidated Summary Prompt (1 call per paper)

**The v1 spec made 5 separate AI calls per paper. v2 makes 1.**

```typescript
const SYSTEM_PROMPT = `You are a research paper summarizer. 
Return ONLY a valid JSON object with no preamble, explanation, or markdown fences.`;

const USER_PROMPT = `Summarize this paper abstract into the following JSON structure.
Be concrete and specific. Avoid vague phrases like "this paper proposes" or "we show that".

Abstract:
{abstract}

Return exactly this JSON shape:
{
  "tldr": "80-120 word summary for a technical audience. State the contribution directly.",
  "key_contributions": ["verb-led bullet 1", "verb-led bullet 2", "verb-led bullet 3"],
  "methods": ["method/technique 1", "method/technique 2", "method/technique 3"],
  "limitations": ["limitation 1", "limitation 2"],
  "beginner_explain": "100-200 word plain explanation for a software engineer with no ML background",
  "technical_summary": "200-300 word precise technical description preserving mathematical terminology"
}`;

const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: USER_PROMPT.replace('{abstract}', paper.abstract) },
  ],
  response_format: { type: 'json_object' },  // structured output — no fragile text parsing
  max_tokens: 1024,
});

const summary = JSON.parse(response.response) as SummaryFields;
```

### 6.5 Related Papers: Pre-Computed at Ingestion

```typescript
async function computeRelatedPapers(
  paperId: string,
  embedding: number[],
  env: Env
): Promise<void> {
  // Query Vectorize — only happens during ingestion, never in hot path
  const results = await env.VECTORIZE.query(embedding, {
    topK: 9,                                    // 9 to exclude self
    filter: { paper_id: { $ne: paperId } },     // exclude self
    returnMetadata: true,
  });

  const related = results.matches
    .slice(0, 8)
    .map((m, i) => ({
      paper_id: paperId,
      related_paper_id: m.metadata.paper_id,
      similarity_score: m.score,
      rank: i + 1,
      computed_at: new Date().toISOString(),
    }));

  // Write to D1 — available permanently, no re-querying Vectorize
  await env.DB.batch(
    related.map(r =>
      env.DB.prepare(`
        INSERT OR REPLACE INTO related_papers
          (paper_id, related_paper_id, similarity_score, rank, computed_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(r.paper_id, r.related_paper_id, r.similarity_score, r.rank, r.computed_at)
    )
  );
}
```

### 6.6 Ingestion Error Handling

```
- summary_ready = 0 (pending), 1 (done), 2 (failed)
- Failed papers are retried on next cron run (WHERE summary_ready = 0 OR summary_ready = 2)
- After 3 failures, set summary_ready = 2 permanently and log
- Ingestion never blocks on single-paper failure: Promise.allSettled() for all parallel work
- arXiv 429: exponential backoff (60s, 120s, give up)
- Workers AI error: mark paper as failed, continue batch
```

---

## 7. Search Implementation

### 7.1 Hybrid Search Flow

```
User query: "efficient attention for long contexts"
        ↓
Step 1: Normalize query
  - lowercase, trim
  - strip common stopwords for keyword path only
  - compute cache key: sha256(normalized_q)
        ↓
Step 2: Check KV search cache
  - HIT → return immediately (saves all subsequent steps)
        ↓
Step 3a: D1 FTS keyword search (parallel with 3b)
  SELECT p.*, s.tldr
  FROM papers_fts f
  JOIN papers p ON p.id = f.paper_id
  JOIN summaries s ON s.paper_id = p.id
  WHERE papers_fts MATCH ?
  ORDER BY bm25(papers_fts, 10.0, 1.0, 5.0)  ← title:abstract:authors = 10:1:5
  LIMIT 20
        ↓
Step 3b: Vectorize semantic search (parallel with 3a)
  - Check KV for cached query embedding: kv:embed:{sha256(q)}
    - HIT: use cached embedding (saves Workers AI call)
    - MISS: call Workers AI embed, write to KV (TTL 24h)
  - Query Vectorize top-20 with cached/fresh embedding
        ↓
Step 4: Merge + deduplicate by paper_id
  - Papers in both sets get combined score
  - keyword-only: score = keyword_rank_norm * 0.25
  - semantic-only: score = similarity * 0.75
  - both: score = keyword_rank_norm * 0.25 + similarity * 0.75
        ↓
Step 5: Return top 10 results, write to KV (TTL 2h)
```

**Change from v1:** Rerank weights changed from 0.4/0.6 → 0.25/0.75. For research paper retrieval, semantic similarity is more reliable than exact keyword matching. Acronyms and method names are handled by the hybrid merge (a keyword match for "RLHF" boosts into the result set; semantic handles paraphrases).

**Change from v1:** Query embedding is now cached in KV. Popular search terms ("diffusion models", "RAG", "LoRA") will be embedded once and reused for 24h, cutting Workers AI neuron consumption from searches by an estimated 60–80%.

### 7.2 D1 FTS Query (with title boosting)

```sql
-- v1 had equal weights; v2 boosts title match 10× over abstract
SELECT
  p.id, p.title, p.authors, p.published_at, p.categories,
  s.tldr,
  bm25(papers_fts, 10.0, 1.0, 5.0) AS keyword_score
FROM papers_fts f
JOIN papers p  ON p.id  = f.paper_id
JOIN summaries s ON s.paper_id = p.id
WHERE papers_fts MATCH ?
  AND p.summary_ready = 1
ORDER BY keyword_score
LIMIT 20;
```

---

## 8. Caching Strategy

### 8.1 TTL Reference Table

| Data | Layer | TTL | Notes |
|---|---|---|---|
| Paper + summary | KV → CDN | Permanent | Written lazily on first access |
| Related papers | KV → D1 | Permanent | Written lazily on first access |
| Search results | KV | 2h | Fixed TTL (v1 had variable 1–6h complexity) |
| Query embeddings | KV | 24h | New in v2 — cuts Workers AI search cost |
| Topic pages | KV → CDN | 12h | — |
| Trending papers | KV → CDN | 60 min | — |
| Author pages | KV → D1 | 6h | — |

### 8.2 Lazy KV Write Pattern (replaces eager writes)

**v1 problem:** Ingestion wrote every paper to KV immediately → 1,600 writes/day → breaks free tier.

**v2 fix:** KV is populated on first user access, not at ingestion time.

```typescript
async function getPaperFull(id: string, env: Env): Promise<PaperWithSummary | null> {
  const cacheKey = `kv:paper:${id}:full`;

  // Try KV first
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return cached as PaperWithSummary;

  // Miss: read from D1
  const paper = await env.DB.prepare(`
    SELECT p.*, s.tldr, s.key_contributions, s.methods,
           s.limitations, s.beginner_explain, s.technical_summary
    FROM papers p
    JOIN summaries s ON s.paper_id = p.id
    WHERE p.id = ? AND p.summary_ready = 1
  `).bind(id).first<PaperWithSummary>();

  if (!paper) return null;

  // Write to KV for future requests (fire and forget — don't await)
  env.CACHE.put(cacheKey, JSON.stringify(paper));  // no TTL = permanent

  return paper;
}
```

**KV write volume with lazy pattern:**
- Ingestion: 0 writes (down from 1,600/day)
- First access per paper: 1 write (amortized over all users, ~200-500/day for new papers)
- Total: stays well under 1,000/day free tier limit

### 8.3 Cache Miss Fallback

If a paper summary is not yet generated (ingestion in-flight):
1. Return paper metadata from D1 immediately (always available after step 3 of ingestion)
2. Show abstract in place of AI summary
3. Display: `"AI summary generating — check back shortly"`
4. Never trigger a live Workers AI call in the request path

---

## 9. Environment & Configuration

### 9.1 wrangler.toml (api-worker)

```toml
name = "arxiv-api"
main = "src/api-worker/index.ts"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"

[[d1_databases]]
binding = "DB"
database_name = "arxiv-explorer"
database_id = "your-d1-database-id"

[[vectorize]]
binding = "VECTORIZE"
index_name = "arxiv-papers"

[ai]
binding = "AI"  # only used for query embedding; never for summarization
```

### 9.2 wrangler.toml (ingest-worker)

```toml
name = "arxiv-ingest"
main = "src/ingest-worker/index.ts"
compatibility_date = "2025-01-01"

[triggers]
crons = ["0 * * * *"]  # every hour

[[d1_databases]]
binding = "DB"
database_name = "arxiv-explorer"
database_id = "your-d1-database-id"   # same DB as api-worker

[[vectorize]]
binding = "VECTORIZE"
index_name = "arxiv-papers"

[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"           # same KV as api-worker

[ai]
binding = "AI"
```

### 9.3 Environment Variables

```
# Shared
ARXIV_FETCH_CATEGORIES=cs.LG,cs.CL,cs.CV,stat.ML
SUMMARY_MODEL=@cf/meta/llama-3.1-8b-instruct
EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5

# Ingestion tuning
ARXIV_FETCH_LIMIT_PER_CATEGORY=30    # conservative: 4 categories × 30 = 120 papers max/hour
INGEST_MAX_CONCURRENT=5
ARXIV_RATE_LIMIT_DELAY_MS=3000

# Cache TTLs
CACHE_TTL_SEARCH_SECONDS=7200        # 2h
CACHE_TTL_TRENDING_SECONDS=3600      # 60min
CACHE_TTL_EMBED_SECONDS=86400        # 24h

# CORS
ALLOWED_ORIGIN=https://arxiv-explorer.pages.dev
```

---

## 10. Workers AI Model Selection

| Task | Model | Called from | Notes |
|---|---|---|---|
| Summarization | `@cf/meta/llama-3.1-8b-instruct` | ingest-worker only | 1 call/paper via structured JSON output |
| Embeddings (ingestion) | `@cf/baai/bge-base-en-v1.5` | ingest-worker only | 1 call/paper |
| Embeddings (search) | `@cf/baai/bge-base-en-v1.5` | api-worker | 1 call/unique query; cached 24h |

**No Workers AI calls for related papers retrieval, paper detail pages, topic pages, or trending.**

---

## 11. Project Structure

```
/
├── src/
│   ├── api-worker/
│   │   ├── index.ts              # Worker entrypoint, routing
│   │   ├── routes/
│   │   │   ├── search.ts         # Hybrid search + KV cache
│   │   │   ├── paper.ts          # Paper detail (lazy KV write)
│   │   │   ├── related.ts        # Related papers (D1 → KV)
│   │   │   ├── topic.ts
│   │   │   ├── trending.ts
│   │   │   └── author.ts
│   │   └── cache/
│   │       ├── kv.ts             # Lazy get/set helpers
│   │       └── keys.ts           # Cache key constants
│   │
│   ├── ingest-worker/
│   │   ├── index.ts              # Scheduled handler entrypoint
│   │   ├── fetch-arxiv.ts        # Atom XML fetch + rate limiting
│   │   ├── generate-summary.ts   # Single consolidated JSON prompt
│   │   ├── generate-embedding.ts # Workers AI embed wrapper
│   │   ├── compute-related.ts    # Vectorize query → D1 insert
│   │   └── pipeline.ts           # Orchestrates batch processing
│   │
│   └── shared/
│       ├── types.ts              # Shared TypeScript interfaces
│       ├── db.ts                 # D1 query helpers
│       └── utils.ts
│
├── app/                          # Next.js app (Cloudflare Pages)
│   ├── page.tsx
│   ├── search/page.tsx
│   ├── paper/[arxiv_id]/page.tsx
│   ├── topic/[slug]/page.tsx
│   ├── author/[name]/page.tsx
│   └── sitemap.ts                # Auto-generated sitemap
│
├── components/
│   ├── SearchBox.tsx
│   ├── PaperCard.tsx
│   ├── PaperDetail.tsx
│   ├── SummarySection.tsx
│   ├── RelatedPapers.tsx
│   └── CategoryBadge.tsx
│
├── wrangler.api.toml
├── wrangler.ingest.toml
└── next.config.ts
```

---

## 12. TypeScript Types

```typescript
// src/shared/types.ts

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
  revisedAt?: string;
  pdfUrl: string;
  htmlUrl?: string;
  summaryReady: 0 | 1 | 2;
}

export interface Summary {
  paperId: string;
  tldr: string;
  keyContributions: string[];
  methods: string[];
  limitations: string[];
  beginnerExplain: string;
  technicalSummary: string;
  generatedAt: string;
  modelVersion: string;
}

export interface PaperWithSummary extends Paper {
  summary: Summary | null;  // null when summaryReady !== 1
}

export interface RelatedPaper {
  id: string;
  title: string;
  tldr: string;
  similarityScore: number;
  rank: number;
}

export interface SearchResult {
  papers: PaperWithSummary[];
  total: number;
  cached: boolean;
  cacheAge?: number;     // ms since cache was written — useful for debugging
  query: string;
}

export interface IngestResult {
  fetched: number;
  newPapers: number;
  summarized: number;
  failed: number;
  neuronsEstimate: number;
}
```

---

## 13. MVP Roadmap

### Phase 1 — Core Search & Summaries (Week 1–3)

**Deliverables:**
- [ ] D1 schema with all indexes migrated
- [ ] Vectorize index initialized
- [ ] `ingest-worker` running on cron with consolidated JSON prompt
- [ ] `api-worker` with `/api/search`, `/api/paper/:id`
- [ ] Lazy KV write pattern implemented
- [ ] Query embedding caching in KV
- [ ] Next.js: Home + Search + Paper detail
- [ ] Deployed to Cloudflare Pages + Workers
- [ ] `robots.txt` and `sitemap.ts` added

**Success criteria:** 
- Search returns cached results in <300ms
- Paper detail page: zero Workers AI calls in hot path
- KV write volume: <500/day
- Workers AI neuron usage: <5,000/day

---

### Phase 2 — Related Papers & Polish (Week 4–5)

**Deliverables:**
- [ ] `compute-related.ts` in ingest pipeline (Vectorize → D1 `related_papers`)
- [ ] `/api/paper/:id/related` endpoint with lazy KV write
- [ ] Related papers component on paper detail page
- [ ] Author pages
- [ ] Category filter on search results
- [ ] FTS title boosting (bm25 weights) tuned via A/B test

---

### Phase 3 — Topic Pages (Week 6–7)

**Deliverables:**
- [ ] Topic taxonomy (15–20 topics defined in D1)
- [ ] Topic pages `/topic/:slug` with CDN cache
- [ ] Topic → paper mapping via category tags + FTS
- [ ] Topic chips on homepage

---

### Phase 4 — Lightweight Q&A *(Optional, post-launch)*

Only if user demand justifies. Hard constraints:
- Input: only the cached summary (never full PDF)
- 300 input tokens max, 200 output tokens max
- 5 requests/IP/minute rate limit
- Cached: identical question+paper pairs return cached answers (KV, 24h)

---

## 14. Free Tier Feasibility (Corrected)

| Resource | Free Tier | v1 Estimate | v2 Realistic | Status |
|---|---|---|---|---|
| Workers requests | 100k/day | ~30k/day | ~30k/day | ✅ Safe |
| KV reads | 100k/day | ~50k/day | ~50k/day | ✅ Safe |
| KV writes | 1k/day | ~~200/day~~ (wrong: ~1,600) | ~400/day (lazy writes) | ✅ Safe |
| D1 row reads | 25M/month | ~500k/month | ~2M/month | ✅ Safe |
| Vectorize queries | 30M/month | ~1M/month | ~300k/month (ingestion only) | ✅ Safe |
| Workers AI neurons | 10k/day | ~~"safe"~~ (wrong: ~10x over) | ~4,000/day (10 papers/hr) | ✅ Safe |
| Cloudflare Pages | Unlimited | — | — | ✅ Free |

**Ingestion rate on free tier:** 10 papers/hour (240/day) staying within neuron budget.

**Scaling path:** Workers AI paid tier ($0.011/1k neurons) enables ~1,200 papers/day for ~$0.58/day. Upgrade this single line when ready.

---

## 15. What to Explicitly Not Build

| Feature | Why Deferred |
|---|---|
| Persistent AI chat | Every message = live inference, no caching possible |
| PDF upload & analysis | Breaks cache model, unpredictable token cost |
| Personalized feeds | Per-user state = cache miss by design |
| Multi-paper reasoning | Token cost scales with paper count |
| Code execution | Sandboxing complexity + security risk |
| Collaborative workspaces | Real-time state, operational complexity |
| Voice interface | Latency incompatible with edge architecture |

---

## 16. Monitoring & Observability

**Workers Analytics (built-in):** Request volume, error rates, CPU time per route.

**Custom metrics via KV counters (write async, don't block responses):**

```typescript
// Increment counters without blocking the response
ctx.waitUntil(Promise.all([
  env.CACHE.put('metric:cache_hits', String(hits + 1)),
  env.CACHE.put('metric:d1_reads', String(d1reads + 1)),
]));
```

**Key metrics to track:**

| Metric | Target | Alert threshold |
|---|---|---|
| Cache hit rate (KV) | >85% | <70% |
| D1 fallback rate | <15% | >30% |
| p95 latency (cached) | <200ms | >500ms |
| p95 latency (D1 fallback) | <600ms | >1,200ms |
| Ingestion success rate | >98% | <95% |
| Workers AI neuron usage | <8k/day | >9.5k/day (near limit) |
| KV write count | <700/day | >900/day (near limit) |

---

