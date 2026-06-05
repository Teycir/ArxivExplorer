# Changelog

All notable changes to ArxivExplorer are documented in this file.

**Version:** 1.2.0  
**Development Period:** May 30 - June 5, 2026  
**License:** BSL 1.1 (converts to MIT on 2029-06-01)

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
