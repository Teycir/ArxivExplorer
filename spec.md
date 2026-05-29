# arXiv Explorer — Full Product & Engineering Spec

> **Tagline:** Fast semantic arXiv explorer with cached AI summaries  
> **Stack:** Next.js · Cloudflare Workers · Cloudflare AI · D1 · KV · Vectorize

---

## 1. Product Overview

### 1.1 Vision

A static-first, AI-enhanced search engine for arXiv papers. Not a chatbot. Not a research copilot. A fast, reliable tool that lets any researcher, engineer, or student understand a paper in 60 seconds — without waiting on a live LLM call.

### 1.2 Design Philosophy

| Principle | Meaning |
|---|---|
| **Cache-first** | Most requests hit a cache, not an LLM |
| **Fast > Smart** | Sub-200ms pages beat 3-second AI wizardry |
| **Precompute everything** | Summaries generated once, served forever |
| **No login required** | Zero friction for discovery |
| **Small outputs** | TL;DRs, bullets, short summaries — not essays |

### 1.3 What This Is Not

- Not a conversational AI assistant
- Not a PDF uploader or document processor
- Not a multi-agent reasoning system
- Not a personalized research feed (initially)

---

## 2. User Flows

### 2.1 Discovery Flow (Home → Search → Result)

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
[Full detail page]
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

### 3.1 Home Page (`/`)

**Layout:** Centered, minimal.

**Elements:**
- App name + tagline
- Single search input: `Search papers, topics, methods, authors…`
- Example queries shown as chips:
  - `diffusion transformers`
  - `RAG evaluation`
  - `quantization for LLMs`
  - `RLHF alignment`
- Trending papers strip (cached, refreshed every 60 min)
- Recent category highlights (cs.LG, cs.CL, cs.CV, stat.ML)

**Non-goals:** No login prompt. No onboarding wizard. No personalization widgets.

---

### 3.2 Search Results Page (`/search?q=...`)

**Triggered by:** Text query, category filter, author name, arXiv ID.

**Each result card contains:**

| Field | Notes |
|---|---|
| Title | Linked to `/paper/:id` |
| Authors | First 3, then "et al." |
| Published date | Relative: "3 days ago" |
| arXiv categories | Pill badges |
| Abstract snippet | First 2 sentences |
| **AI TL;DR** | Cached, 80–120 words |
| Actions | Open Summary · View arXiv · Similar Papers |

**Pagination:** 10 results per page, cursor-based.

**Filters (sidebar):**
- Date range
- Category (cs.LG, cs.CL, cs.CV, etc.)
- Sort: Relevance · Newest · Most cited (if available)

**Search behavior:**
- Hybrid: keyword (BM25-style via D1 FTS) + semantic (Vectorize)
- Results merged and reranked
- Full response cached in KV by query hash (TTL: 1–6h)

---

### 3.3 Paper Detail Page (`/paper/:arxiv_id`)

This is the core value page.

**URL structure:** `/paper/2312.00752` or `/paper/abs/2312.00752`

**Page sections (in order):**

#### Section 1 — Header
- Title (h1)
- Authors (linked to author search)
- Published / last revised date
- arXiv categories
- Links: `[View on arXiv]` `[PDF]` `[Cite]`

#### Section 2 — AI TL;DR ⚡
- 80–120 word plain-English summary
- Labeled: "AI Summary · Cached"
- Rendered immediately (precomputed, served from KV/CDN)

#### Section 3 — Key Contributions
- 3–5 bullet points
- Each bullet: one concrete claim from the paper

#### Section 4 — Methods & Techniques
- 3–5 bullet points
- Technical vocabulary preserved

#### Section 5 — Limitations & Caveats
- 2–4 bullet points
- What the paper does NOT claim or address

#### Section 6 — Beginner Explanation *(collapsible)*
- 100–200 words, no jargon
- "Explain this like I'm a software engineer, not an ML researcher"

#### Section 7 — Technical Deep-Dive *(collapsible)*
- 200–400 words
- Preserves mathematical and methodological precision

#### Section 8 — Related Papers
- 5–8 papers from embedding similarity
- Each shown as a mini card (title + TL;DR)
- Sourced from Vectorize; cached per paper ID

#### Section 9 — Original Abstract
- Verbatim arXiv abstract
- Collapsible, defaults closed

---

### 3.4 Author Page (`/author/:name`)

- List of indexed papers by this author
- Sorted by date
- Cached per author name

---

### 3.5 Topic / Category Page (`/topic/:slug`)

Examples: `/topic/rag`, `/topic/diffusion-models`, `/topic/quantization`

**Contents:**
- Short topic description (static or AI-generated once)
- Top papers for this topic (by recency + relevance score)
- Updated daily via scheduled ingestion
- Fully cached, very cheap to serve

---

## 4. Architecture

### 4.1 System Diagram

```
Browser
  ↓
Next.js (Vercel or Cloudflare Pages)
  ↓
Cloudflare CDN (edge cache — most requests stop here)
  ↓
Cloudflare Worker (API layer)
  ↓
KV (hot cache: summaries, popular searches)
  ↓ cache miss only
D1 (metadata, summaries, categories, relations)
  ↓ semantic queries only
Vectorize (embeddings for semantic search + related papers)
  ↓ ingestion pipeline only
Workers AI (Llama / @cf/meta models for summarization)
```

**Key principle:** The CDN and KV layers absorb the vast majority of traffic. D1 and Vectorize handle structured queries. Workers AI is only invoked during the asynchronous ingestion pipeline — never in the hot path for end users.

---

### 4.2 Cloudflare Worker — API Routes

All API routes are served from a single Cloudflare Worker.

| Route | Description | Cache |
|---|---|---|
| `GET /api/search?q=` | Hybrid search | KV, TTL 1–6h |
| `GET /api/paper/:id` | Paper metadata + summary | KV permanent |
| `GET /api/paper/:id/related` | Related papers via Vectorize | KV 24h |
| `GET /api/topic/:slug` | Topic papers list | KV 12h |
| `GET /api/trending` | Trending papers | KV 60min |
| `GET /api/author/:name` | Papers by author | KV 6h |
| `POST /api/ingest` | Internal: trigger ingestion (cron) | — |

**Cache key pattern:**
```
kv:search:{sha256(normalized_query)}
kv:paper:{arxiv_id}:summary
kv:paper:{arxiv_id}:related
kv:topic:{slug}:papers
kv:trending:{date_hour}
```

---

### 4.3 Next.js Frontend

- **Rendering strategy:** Static + ISR (Incremental Static Regeneration)
- Paper detail pages: `generateStaticParams` for popular papers + fallback ISR
- Search page: Client-side fetch to Worker API
- Topic pages: ISR with 1h revalidation
- Home page: ISR with 30min revalidation

**Caching headers set by Worker:**
```
Cache-Control: public, s-maxage=86400, stale-while-revalidate=3600
```

---

## 5. Data Models

### 5.1 D1 — `papers` table

```sql
CREATE TABLE papers (
  id            TEXT PRIMARY KEY,       -- arXiv ID: "2312.00752"
  title         TEXT NOT NULL,
  authors       TEXT NOT NULL,          -- JSON array
  abstract      TEXT NOT NULL,
  categories    TEXT NOT NULL,          -- JSON array: ["cs.LG", "cs.CL"]
  published_at  TEXT NOT NULL,          -- ISO date
  revised_at    TEXT,
  pdf_url       TEXT,
  html_url      TEXT,
  indexed_at    TEXT NOT NULL,
  summary_ready INTEGER DEFAULT 0       -- 0 = pending, 1 = ready
);
```

### 5.2 D1 — `summaries` table

```sql
CREATE TABLE summaries (
  paper_id          TEXT PRIMARY KEY REFERENCES papers(id),
  tldr              TEXT,              -- 80–120 words
  key_contributions TEXT,             -- JSON array of bullets
  methods           TEXT,             -- JSON array of bullets
  limitations       TEXT,             -- JSON array of bullets
  beginner_explain  TEXT,             -- 100–200 words
  technical_summary TEXT,             -- 200–400 words
  generated_at      TEXT NOT NULL,
  model_version     TEXT NOT NULL     -- e.g. "@cf/meta/llama-3.1-8b-instruct"
);
```

### 5.3 D1 — `embeddings_meta` table

```sql
CREATE TABLE embeddings_meta (
  paper_id      TEXT PRIMARY KEY REFERENCES papers(id),
  vectorize_id  TEXT NOT NULL,        -- ID in Vectorize index
  embedded_at   TEXT NOT NULL,
  chunk_count   INTEGER DEFAULT 1
);
```

### 5.4 D1 — `topics` table

```sql
CREATE TABLE topics (
  slug          TEXT PRIMARY KEY,     -- "rag-evaluation"
  label         TEXT NOT NULL,        -- "RAG Evaluation"
  description   TEXT,
  category_tags TEXT,                 -- JSON array of arXiv categories
  updated_at    TEXT NOT NULL
);
```

### 5.5 Vectorize Index Schema

```
Index name: arxiv-papers
Dimensions: 768 (using @cf/baai/bge-base-en-v1.5)
Distance metric: cosine

Metadata per vector:
{
  paper_id: "2312.00752",
  title: "...",
  categories: ["cs.LG"],
  published_at: "2023-12-01"
}
```

---

## 6. Ingestion Pipeline

### 6.1 Overview

Runs as a **Cloudflare Cron Trigger** every hour.

```
[Cron: every hour]
        ↓
Fetch arXiv API (latest papers in target categories)
        ↓
Filter: already indexed? → skip
        ↓
Store metadata → D1 papers table
        ↓
Chunk text (abstract + intro if available)
        ↓
Generate embedding → @cf/baai/bge-base-en-v1.5
        ↓
Upsert to Vectorize
        ↓
Generate summaries → Workers AI (Llama 3.1 8B)
        ↓
Store summaries → D1 summaries table
        ↓
Write to KV → kv:paper:{id}:summary
        ↓
Mark summary_ready = 1
```

### 6.2 arXiv API Fetch

```
GET https://export.arxiv.org/api/query
  ?search_query=cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV+OR+cat:stat.ML
  &sortBy=submittedDate
  &sortOrder=descending
  &max_results=50
```

Run per category group to stay within rate limits. Parse Atom XML response.

### 6.3 Summary Generation Prompts

**TL;DR prompt:**
```
You are a research assistant. Read the following paper abstract and write a 
TL;DR in 80–120 words for a technical audience. Be concrete. 
Avoid vague phrases like "this paper proposes" or "we show that".
State the actual contribution directly.

Abstract:
{abstract}

Respond with only the TL;DR. No preamble.
```

**Key contributions prompt:**
```
List exactly 3–5 key contributions of this paper as concise bullet points.
Each bullet should describe one specific, concrete contribution.
Start each bullet with an action verb.

Abstract:
{abstract}

Respond with only the bullet list, one per line, no numbering.
```

**Limitations prompt:**
```
Based on this abstract, list 2–4 limitations or caveats a critical reader 
should be aware of. Be specific and honest.

Abstract:
{abstract}

Respond with only the bullet list, one per line.
```

**Beginner explanation prompt:**
```
Explain this paper to a software engineer with no ML research background.
Use plain language. 100–200 words. Focus on: what problem it solves, 
how it solves it, and why that matters.

Abstract:
{abstract}
```

### 6.4 Rate Limiting & Error Handling

- Batch Workers AI calls: max 5 concurrent
- Retry failed summaries on next cron run (summary_ready = 0)
- Log errors to Workers Analytics
- Never block ingestion on a single paper failure

---

## 7. Search Implementation

### 7.1 Hybrid Search Flow

```
User query: "efficient attention for long contexts"
        ↓
Step 1: Normalize query (lowercase, strip stopwords for keyword path)
        ↓
Step 2a: D1 FTS keyword search
  SELECT * FROM papers WHERE papers MATCH '{query}'
  LIMIT 20
        ↓
Step 2b: Vectorize semantic search
  embed(query) → search Vectorize top-20
        ↓
Step 3: Merge + deduplicate results by paper_id
        ↓
Step 4: Rerank by combined score:
  score = 0.4 * keyword_rank + 0.6 * vector_similarity
        ↓
Step 5: Fetch summaries for top 10 from KV/D1
        ↓
Step 6: Return response + cache in KV
```

### 7.2 D1 Full-Text Search Setup

```sql
-- Enable FTS virtual table
CREATE VIRTUAL TABLE papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors,
  content=papers,
  content_rowid=rowid
);

-- Trigger to keep in sync
CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(paper_id, title, abstract, authors)
  VALUES (new.id, new.title, new.abstract, new.authors);
END;
```

---

## 8. Caching Strategy

### 8.1 TTL Reference Table

| Data | Cache Layer | TTL |
|---|---|---|
| Paper summary | KV + CDN | Permanent (immutable) |
| Related papers | KV | 24h |
| Search results | KV | 1–6h (by query popularity) |
| Topic pages | KV + CDN | 12h |
| Trending papers | KV + CDN | 60 min |
| Author pages | KV | 6h |
| Homepage | CDN | 30 min |

### 8.2 Cache Warming

After ingestion completes for a batch:
1. Write all paper summaries to KV immediately
2. Pre-compute related papers for new papers
3. Invalidate topic/trending caches that include new papers

### 8.3 Cache Miss Fallback

If a paper summary is not yet in KV (edge case: very new paper, ingestion in-flight):
1. Return paper metadata from D1 immediately
2. Show abstract (always available)
3. Display: "AI summary generating — check back shortly"
4. Do NOT trigger a live LLM call in the request path

---

## 9. Environment & Configuration

### 9.1 Cloudflare Bindings (wrangler.toml)

```toml
name = "arxiv-explorer-api"
compatibility_date = "2024-09-01"

[ai]
binding = "AI"

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

[triggers]
crons = ["0 * * * *"]   # every hour
```

### 9.2 Environment Variables

```
ARXIV_FETCH_CATEGORIES=cs.LG,cs.CL,cs.CV,stat.ML,cs.AI
ARXIV_FETCH_LIMIT=50
SUMMARY_MODEL=@cf/meta/llama-3.1-8b-instruct
EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
CACHE_TTL_SEARCH=21600
CACHE_TTL_TRENDING=3600
INGEST_BATCH_SIZE=10
```

---

## 10. Workers AI Model Selection

| Task | Model | Notes |
|---|---|---|
| Summarization | `@cf/meta/llama-3.1-8b-instruct` | Good quality, fast, free-tier friendly |
| Embeddings | `@cf/baai/bge-base-en-v1.5` | 768-dim, solid for semantic search |
| Fallback summarization | `@cf/mistral/mistral-7b-instruct-v0.1` | If Llama quota exhausted |

All Workers AI calls happen **only** in the ingestion pipeline — never in user-facing request paths.

---

## 11. Next.js Project Structure

```
/
├── app/
│   ├── page.tsx                    # Home
│   ├── search/
│   │   └── page.tsx                # Search results
│   ├── paper/
│   │   └── [arxiv_id]/
│   │       └── page.tsx            # Paper detail
│   ├── topic/
│   │   └── [slug]/
│   │       └── page.tsx            # Topic page
│   └── author/
│       └── [name]/
│           └── page.tsx            # Author page
├── components/
│   ├── SearchBox.tsx
│   ├── PaperCard.tsx               # Result card with TL;DR
│   ├── PaperDetail.tsx             # Full detail sections
│   ├── SummarySection.tsx          # AI summary display
│   ├── RelatedPapers.tsx
│   └── CategoryBadge.tsx
├── lib/
│   ├── api.ts                      # Fetch helpers for Worker API
│   ├── types.ts                    # Shared TypeScript types
│   └── utils.ts
└── worker/
    ├── index.ts                    # Worker entrypoint
    ├── routes/
    │   ├── search.ts
    │   ├── paper.ts
    │   ├── topic.ts
    │   └── trending.ts
    ├── ingestion/
    │   ├── fetch-arxiv.ts
    │   ├── generate-summary.ts
    │   ├── generate-embedding.ts
    │   └── pipeline.ts
    └── cache/
        ├── kv.ts                   # KV read/write helpers
        └── keys.ts                 # Cache key constants
```

---

## 12. TypeScript Type Definitions

```typescript
// lib/types.ts

export interface Paper {
  id: string;                  // "2312.00752"
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: string;
  revisedAt?: string;
  pdfUrl: string;
  htmlUrl?: string;
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
  summary?: Summary;
}

export interface SearchResult {
  papers: PaperWithSummary[];
  total: number;
  cached: boolean;
  query: string;
}

export interface RelatedPaper {
  id: string;
  title: string;
  tldr: string;
  similarity: number;
}
```

---

## 13. MVP Roadmap

### Phase 1 — Core Search & Summaries (Week 1–3)

**Deliverables:**
- [ ] D1 schema created and migrated
- [ ] Vectorize index initialized
- [ ] arXiv ingestion pipeline running on cron
- [ ] Summaries generating for cs.LG + cs.CL + cs.CV
- [ ] Worker API: `/api/search`, `/api/paper/:id`
- [ ] KV caching wired up
- [ ] Next.js: Home page + Search results + Paper detail (basic)
- [ ] Deployed to Cloudflare Pages + Workers

**Success criteria:** Search returns cached results in <300ms. Paper detail renders without live LLM call.

---

### Phase 2 — Related Papers & Polish (Week 4–5)

**Deliverables:**
- [ ] Related papers via Vectorize similarity
- [ ] `/api/paper/:id/related` endpoint + KV cache
- [ ] Related papers component on paper detail page
- [ ] Author pages
- [ ] Category filter on search results
- [ ] Better UI polish: badges, skeletons, responsive layout

---

### Phase 3 — Topic Pages (Week 6–7)

**Deliverables:**
- [ ] Topic taxonomy defined (15–20 topics)
- [ ] Topic pages: `/topic/rag`, `/topic/diffusion-models`, etc.
- [ ] Topic → paper mapping (by category tags + keyword match)
- [ ] Topic pages cached at CDN level (12h TTL)
- [ ] Topic chips on homepage

---

### Phase 4 — Lightweight Q&A *(Optional, post-launch)*

**Only if user demand justifies it.**

**Constraints (non-negotiable):**
- Hard limit: 300 tokens in, 200 tokens out
- Context: only the cached summary, never the full PDF
- No memory between requests
- Rate-limited per IP: 5 requests/minute
- Still cached: identical questions on same paper return cached answers

---

## 14. Free Tier Feasibility

| Resource | Free Tier Limit | Expected Usage | Status |
|---|---|---|---|
| Workers requests | 100k/day | ~30k/day | ✅ Safe |
| KV reads | 100k/day | ~50k/day | ✅ Safe |
| KV writes | 1k/day | ~200/day (ingestion) | ✅ Safe |
| D1 queries | 5M/month | ~500k/month | ✅ Safe |
| Vectorize queries | 30M/month | ~1M/month | ✅ Safe |
| Workers AI neurons | 10k/day | Ingestion only | ✅ Safe |
| Cloudflare Pages | Unlimited | — | ✅ Free |

**Key insight:** Because summaries are precomputed and cached, Workers AI neurons are only consumed during ingestion (50 papers/hour × 5 prompts = 250 AI calls/hour at most) — not per user page view.

---

## 15. What to Explicitly Not Build

The following features are **indefinitely deferred**. They destroy cacheability and increase cost nonlinearly:

| Feature | Why Deferred |
|---|---|
| Persistent AI chat | Every message = live inference, no caching possible |
| PDF upload & analysis | Unpredictable size, breaks cache model |
| Personalized feeds | Per-user state = cache miss by design |
| Multi-paper reasoning | Token cost scales with paper count |
| Autonomous research agents | LangGraph loops = unbounded inference |
| Code execution | Sandboxing complexity, security risk |
| Collaborative workspaces | Real-time state, operational complexity |
| Voice interface | Latency incompatible with edge architecture |

---

## 16. Monitoring & Observability

- **Cloudflare Analytics:** Request volume, cache hit rate, error rates
- **Workers Analytics:** Per-route latency, KV hit/miss ratio
- **Custom KV counter:** Track cache hit % per paper ID
- **Ingestion logs:** Papers processed per run, summary failures, embedding failures
- **Alerting threshold:** Cache hit rate < 80% → investigate

**Target metrics:**
- Cache hit rate: >85%
- p95 API latency: <200ms (cached), <800ms (D1 fallback)
- Ingestion success rate: >99%
- Summary generation failure rate: <1%

---

*Spec version: 1.0 — Ready for Phase 1 implementation*