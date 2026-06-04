<!-- donation:eth:start -->
<div align="center">

## Support Development

If this project helps your work, support ongoing maintenance and new features.

**ETH Donation Wallet**  
`0x11282eE5726B3370c8B480e321b3B2aA13686582`

<a href="https://etherscan.io/address/0x11282eE5726B3370c8B480e321b3B2aA13686582">
  <img src="public/publiceth.svg" alt="Ethereum donation QR code" width="220" />
</a>

_Scan the QR code or copy the wallet address above._

</div>
<!-- donation:eth:end -->


<div align="center">

![License](https://img.shields.io/badge/license-BSL%201.1-neon_green?style=for-the-badge)
![Framework](https://img.shields.io/badge/Framework-Next.js%2016-neon_green?style=for-the-badge)
![Hosting](https://img.shields.io/badge/Hosting-Cloudflare%20Workers-neon_green?style=for-the-badge)
![Database](https://img.shields.io/badge/Database-Cloudflare%20D1-neon_green?style=for-the-badge)
![Vector](https://img.shields.io/badge/Vector-Cloudflare%20Vectorize-neon_green?style=for-the-badge)
![AI](https://img.shields.io/badge/AI-Workers%20AI%20%7C%20Llama%203.1-neon_green?style=for-the-badge)
![Embeddings](https://img.shields.io/badge/Embeddings-BGE%20base%20v1.5-neon_green?style=for-the-badge)
![Local](https://img.shields.io/badge/Local%20Bulk-Ollama-neon_green?style=for-the-badge)

<img src="public/arxiv_ascii.svg" alt="arXiv Explorer Animation">

**Fast semantic arXiv paper search with AI-powered summaries — no login required.**

### _"Research papers, decoded.."_

</div>

## Features

- **Hybrid Search** — Combines keyword (BM25) and semantic (vector) search for accurate results
- **Advanced Filtering** — Filter by author, citation count, category, and date range (day/week/month)
- **RSS Feed** — Subscribe to recent papers with AI summaries at `/rss.xml` (1-hour cache, 20 papers)
- **AI Summaries** — Pre-generated summaries with TL;DR, key contributions, methods, limitations, and enriched metadata
- **Related Papers** — Discover similar papers through semantic similarity
- **Topic Browsing** — Curated collections for popular research areas
- **Citation Tracking** — Real-time citation counts from Semantic Scholar with automatic updates
- **Paper Collections** — Organize bookmarks into playlists with JSON/BibTeX export
- **Paper Comparison** — Side-by-side comparison of up to 6 papers with field selector and CSV/Markdown export
- **Paper Revisions** — View revision history and version comparison for updated papers
- **Achievements System** — Gamified badges for user engagement (explorer, researcher, curator, etc.)
- **Claim Tracker** — Find papers that support or contradict specific scientific claims using AI classification
- **Citation Velocity** — Track papers with highest citation momentum (30-day growth rate)
- **Research Frontier** — Discover bleeding-edge papers pushing the boundaries of their fields
- **Author Timeline** — Visualize researcher's intellectual journey showing topic evolution and focus shifts
- **Speed Dating Mode** — Swipe-based taste profiling to build personalized paper recommendations
- **Reading Path** — Find shortest learning path between papers via prerequisites and related papers
- **CLI Tool** — Command-line interface for AI assistants (Claude, ChatGPT) to search and explore papers
- **Zero Latency AI** — All summaries pre-computed, served from edge cache
- **No Login Required** — Instant access to all features

## Architecture

Built on Cloudflare's edge platform for global performance:

- **Frontend**: Next.js deployed as a **Cloudflare Worker** (via OpenNext + `main` + `assets` mode)
- **API**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Vector Search**: Cloudflare Vectorize
- **Cache**: Cloudflare KV
- **AI**: Workers AI (Llama 3.1 + BGE embeddings) for live inference; local Ollama for bulk ingestion

> **Deployment note**: The frontend is deployed as a Worker (not Cloudflare Pages) to avoid the
> per-request nonce injection that Pages unconditionally adds to `script-src`, which breaks the
> app's CSP.

### System Design

```
Browser → Next.js Worker → API Worker → KV Cache → D1 Database
                                            ↓
                                       Vectorize
                                            ↑
                                  Ingest Worker (Cron)
                                            ↑
                              Workers AI  /  local Ollama
```

## Data Pipeline

Papers flow through a multi-stage pipeline:

### 1. Fetch Stage
Ingest worker polls the arXiv API on cron schedule (`0 * * * *` hourly) and writes new papers to D1 with `summary_ready = 0`.

### 2. Summarize Stage
Either the ingest worker (Workers AI, rate-limited) or the local bulk script (Ollama, unlimited) generates:
- Structured summaries (tldr, contributions, methods, limitations, explanations)
- Paper embeddings for semantic search
- Sets `summary_ready = 1` when complete

### 3. Enrichment Stage (optional)
- **Citations**: Semantic Scholar API updates citation counts via cron
- **CrossRef**: DOI-based metadata enrichment (daily cron `30 2 * * *`)
- **OpenAlex**: Concepts, affiliations, open access metadata
- **Papers With Code**: Code repositories, benchmarks, SOTA rankings

### 4. Related Papers
Pre-computes top-8 semantically similar papers using Vectorize and stores in `related_papers` table.

### Cron Schedule

The ingest worker has two cron triggers:
- `* * * * *` — Every minute (processes 1 paper per run with 1 retry on failure)
- `30 2 * * *` — Daily CrossRef enrichment batch (50 papers per run)

Citation updates run as part of the minutely cron, fetching data from Semantic Scholar API.

### Bulk Local Processing

When remote Workers AI hits rate limits, use the local Ollama pipeline to catch up:

```bash
# Process all pending/failed papers from remote D1 using local Ollama
ADMIN_SECRET=<secret> npx tsx scripts/retry-failed-local.ts

# Push a fully-processed local DB up to remote D1 + Vectorize
ADMIN_SECRET=<secret> npx tsx scripts/push-local-to-remote.ts

# Bulk ingest (fetch + summarize + embed in one pass)
npx tsx scripts/bulk-ingest.ts --days 7 --categories cs.LG,cs.CL
```

Both scripts use the **D1 REST API** directly (no `wrangler` subprocess per paper), which is ~100× faster than the naive approach and avoids shell-escaping issues with special characters in paper text.

**Ollama models used locally:**
| Role | Model |
|------|-------|
| Summarisation | `gemma4:e4b` (8 B, Q4\_K\_M) |
| Embeddings | `nomic-embed-text` (137 M, F16) |


## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Wrangler CLI: `npm install -g wrangler`

### Installation

```bash
git clone https://github.com/yourusername/arxiv-explorer.git
cd arxiv-explorer
npm install
wrangler login

# Create infrastructure
wrangler d1 create arxiv-explorer
wrangler kv:namespace create CACHE
wrangler vectorize create arxiv-papers --dimensions=768 --metric=cosine

# Update wrangler config files with your IDs
# Edit: wrangler.api.toml, wrangler.ingest.toml, wrangler.jsonc

# Apply database schema (canonical version)
wrangler d1 execute arxiv-explorer --remote --file=migrations/schema.sql

# Copy and fill env files
cp .env.local.example .env.local
cp scripts/config.local.example.ts scripts/config.local.ts
# Edit scripts/config.local.ts with your Cloudflare credentials
```

### Development

```bash
npm run dev                                  # Next.js dev server
wrangler dev --config wrangler.api.toml      # API worker
wrangler dev --config wrangler.ingest.toml   # Ingest worker
```

Visit [http://localhost:3000](http://localhost:3000)

### Deployment

```bash
# Full deployment (Next.js + API worker)
./deploy.sh

# Or individually:
npm run deploy          # Next.js frontend (Worker mode via OpenNext)
npm run deploy:api      # API worker
npm run deploy:ingest   # Ingest worker

# Note: deploy.sh does NOT deploy ingest worker
# Deploy ingest worker manually when needed
```

## Project Structure

```
├── app/                        # Next.js 16 app directory
│   ├── page.tsx               # Home page
│   ├── search/                # Search results
│   ├── paper/[id]/            # Paper detail pages
│   ├── topic/[slug]/          # Topic pages
│   ├── author/[name]/         # Author pages
│   ├── concept/[name]/        # Concept pages
│   ├── institution/[slug]/    # Institution pages
│   ├── compare/               # Paper comparison
│   ├── diff/[id]/             # Paper revision history
│   ├── bookmarks/             # Bookmark management
│   ├── playlists/             # Playlist management
│   ├── explore/               # Explore page
│   ├── achievements/          # Achievement tracking
│   ├── rss.xml/               # RSS feed route
│   │   └── route.ts
│   └── components/            # React components
│       ├── SummarySection.tsx
│       ├── PaperCard.tsx
│       ├── SearchFilters.tsx
│       ├── BookmarkButton.tsx
│       ├── CollectionManager.tsx
│       └── ... (40+ components)
├── src/
│   ├── api-worker/            # Cloudflare Workers API
│   │   ├── index.ts           # Router
│   │   └── routes/
│   │       ├── search.ts      # Hybrid search (BM25 + semantic)
│   │       ├── paper.ts       # Paper details
│   │       ├── related.ts     # Related papers
│   │       ├── trending.ts    # Trending papers
│   │       ├── topic.ts       # Topic endpoints
│   │       ├── author.ts      # Author endpoints
│   │       ├── citations.ts   # Citation data
│   │       ├── admin.ts       # Admin endpoints (Vectorize, maintenance)
│   │       ├── enrichment.ts  # Data enrichment endpoints
│   │       ├── concept.ts     # Concept search
│   │       ├── institution.ts # Institution search
│   │       ├── stats.ts       # Database statistics
│   │       └── sitemap.ts     # Sitemap generation
│   ├── ingest-worker/         # Background processing (cron)
│   │   ├── index.ts           # Cron entrypoint
│   │   ├── pipeline.ts        # Main ingestion pipeline
│   │   ├── fetch-arxiv.ts     # arXiv API fetcher
│   │   ├── generate-summary.ts
│   │   ├── generate-embedding.ts
│   │   ├── generate-entities.ts
│   │   ├── update-citations.ts # Semantic Scholar sync
│   │   ├── fetch-crossref.ts  # CrossRef enrichment
│   │   ├── fetch-openalex.ts  # OpenAlex enrichment
│   │   ├── fetch-pwc.ts       # Papers With Code enrichment
│   │   ├── compute-related.ts # Related papers computation
│   │   └── tfidf.ts           # TF-IDF utilities
│   └── shared/                # Shared types & utils
│       ├── types.ts           # TypeScript interfaces
│       ├── db.ts              # Database helpers
│       └── utils.ts           # Utilities
├── scripts/
│   ├── push-local-to-remote.ts   # Sync local → remote D1 + Vectorize
│   ├── retry-failed-local.ts     # Reprocess pending papers via Ollama
│   ├── bulk-ingest.ts            # Full bulk ingest pipeline
│   ├── sync-remote-to-local.ts   # Sync remote → local
│   ├── backfill-*.ts             # Various backfill scripts
│   ├── upload-embeddings.ts      # Standalone Vectorize uploader
│   ├── test-*.sh                 # Test scripts
│   ├── config.local.example.ts   # Local config template
│   └── ... (25+ utility scripts)
├── migrations/
│   ├── schema.sql             # Canonical D1 schema (single source of truth)
│   ├── 0001_schema.sql        # Initial migration (legacy)
│   └── 000*.sql               # Other migrations
├── helper/                    # API client helpers
├── lib/                       # Frontend libraries
├── wrangler.api.toml          # API worker config
├── wrangler.ingest.toml       # Ingest worker config
├── wrangler.jsonc             # Next.js worker config (frontend)
├── next.config.ts             # Next.js configuration
├── open-next.config.ts        # OpenNext Cloudflare adapter config
└── deploy.sh                  # Deployment script
```

## API Reference

```
GET  /api/search?q=attention+mechanisms              # Hybrid BM25 + semantic search
GET  /api/search?q=...&author=Hinton                  # Filter by author (substring match)
GET  /api/search?q=...&minCitations=10                # Filter by minimum citations
GET  /api/search?q=...&category=cs.LG                 # Filter by arXiv category
GET  /api/search?q=...&date=week                      # Filter by date (day/week/month)
GET  /api/search?q=...&author=X&minCitations=Y&...    # Combine multiple filters
GET  /api/paper/:id                                   # Paper detail + summary
GET  /api/paper/:id/related                           # Semantically similar papers
GET  /api/citations/:id                               # Citation count from Semantic Scholar
GET  /api/trending                                    # Trending papers (KV cached)
GET  /api/topic/:slug                                 # Topic paper collection
GET  /api/topics                                      # List all topics
GET  /api/author/:name                                # Author papers and statistics
GET  /api/concept/:name                               # Papers by concept
GET  /api/institution/:slug                           # Papers by institution
GET  /api/stats                                       # Database statistics
GET  /api/sitemap                                     # Sitemap for SEO
GET  /rss.xml                                         # RSS feed (20 recent papers, 1h cache)
GET  /compare?ids=id1,id2,id3                         # Compare up to 6 papers side-by-side

POST /admin/vectorize/upsert                          # Bulk embed upsert (x-admin-secret)
POST /admin/retry-failed                              # Reset summary_ready=2 → 0
POST /admin/enrichment/*                              # Enrichment endpoints (OpenAlex, CrossRef, etc.)
```

## Configuration

### Environment Variables

```bash
# .env.local (Next.js frontend)
NEXT_PUBLIC_API_BASE=https://arxiv-api.yourdomain.workers.dev
API_BASE=https://arxiv-api.yourdomain.workers.dev
```

```typescript
// scripts/config.local.ts (for local scripts)
export const CF_TOKEN = 'your-cloudflare-api-token';
export const CF_ACCOUNT_ID = 'your-account-id';
export const CF_D1_ID = 'your-d1-database-id';
```

### Ingestion Settings (`wrangler.ingest.toml`)

```toml
[vars]
ARXIV_FETCH_CATEGORIES = "cs.AI,cs.LG"                 # Default categories
ARXIV_FETCH_LIMIT_PER_CATEGORY = "0"                   # Papers per category per cron (0 = process pending only)
INGEST_MAX_CONCURRENT = "1"                            # Concurrent AI processing
ARXIV_RATE_LIMIT_DELAY_MS = "3000"                     # Delay between arXiv requests
SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct"       # Workers AI summary model
EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"          # Workers AI embedding model
INGEST_PHASE = "hourly"                                # Phase identifier
POLITE_EMAIL = "your-email@example.com"                # Contact email for arXiv API

# Optional Ollama (local AI)
# OLLAMA_BASE = "https://your-tunnel.trycloudflare.com"
# OLLAMA_SUMMARY_MODEL = "gemma4:e4b"
# OLLAMA_EMBEDDING_MODEL = "nomic-embed-text"
```

**Minutely cron schedule**:
- Processes exactly 1 pending paper per run (summary_ready = 0 or failed within 7 days)
- Retries once on failure (2 total attempts)
- Daily quota: 113 papers/day max (5,000 neurons, 50% of daily budget reserved for tooltips)
- Quota tracking via KV with automatic reset at 00:00 UTC

### Admin Secret

Required for Vectorize upserts, maintenance endpoints, and enrichment endpoints:

```bash
# Set for API worker
wrangler secret put ADMIN_SECRET --config wrangler.api.toml

# Use in local scripts
ADMIN_SECRET=your-secret npx tsx scripts/push-local-to-remote.ts
```


## Database Schema

### papers
- arXiv metadata (id, title, authors, abstract, categories, dates, URLs)
- `authors_normalized` — lowercased for fast prefix search
- `citation_count` — from Semantic Scholar (updated hourly via cron)
- `citations_updated_at` — last citation sync timestamp
- `summary_ready`: `0` = pending · `1` = done · `2` = failed
- Additional fields: `comment`, `journal_ref`, `doi`, `primary_category`

### summaries
- `tldr` — one-sentence result
- `key_contributions` — JSON array
- `methods` — JSON array
- `limitations` — JSON array
- `beginner_explain` — plain-language paragraph
- `technical_summary` — researcher-level paragraph
- `model_version` — which model generated it

### Supporting tables
- `paper_categories` — normalized category rows (indexed for topic queries)
- `papers_fts` — FTS5 virtual table with insert/update/delete triggers
- `embeddings_meta` — tracks embedding generation per paper
- `related_papers` — pre-computed top-8 semantic neighbors
- `topics` — curated topic collections with category mappings

### Canonical schema file

The **single source of truth** is `migrations/schema.sql` (not `migrations/0001_schema.sql`).

### Rebuild from scratch

```bash
# Apply canonical schema (wipes and recreates all tables)
wrangler d1 execute arxiv-explorer --remote --file=migrations/schema.sql

# Push local data (papers, summaries, categories, FTS, embeddings)
ADMIN_SECRET=<secret> npx tsx scripts/push-local-to-remote.ts
```

## Performance

- **Search**: <240 ms average (KV cache hit) · <400 ms (D1 fallback)
- **Paper detail**: <190 ms average (KV cache hit) · <500 ms (D1 fallback)
- **Cache hit rate**: ~85% (188ms average cache hit time)
- **Throughput**: 50 req/s under mixed load
- **Edge deployment**: Global CDN via Cloudflare Workers
- **Stress tested**: 100 concurrent requests, 0% error rate

## Key Features

### Citation Tracking
- **Endpoint**: `GET /api/citations/:id`
- **Source**: Semantic Scholar API
- **Updates**: Automatic cron job (update-citations worker)
- **Storage**: `citation_count` and `citations_updated_at` fields in papers table
- **Rate Limiting**: Respects Semantic Scholar rate limits

### Paper Collections
- **Location**: `/bookmarks` page
- **Storage**: Client-side localStorage
- **Features**:
  - Create named collections
  - Assign bookmarks to collections
  - Export as JSON or BibTeX
  - Export all bookmarks or by collection
- **Capacity**: 100 bookmarks (soft cap), 90-day TTL

### Advanced Search Filters
- **Author Filter**: `?author=Hinton` — substring match across all authors
- **Citation Filter**: `?minCitations=10` — minimum citation threshold
- **Category Filter**: `?category=cs.LG` — arXiv category code (cs.LG, cs.CL, cs.CV, etc.)
- **Date Filter**: `?date=week` — time window (day/week/month)
- **Combined Filters**: All filters work together and with hybrid search
- **Caching**: Separate KV cache keys per filter combination (2h TTL)
- **Example**: `/api/search?q=transformer&author=Vaswani&minCitations=100&category=cs.LG&date=month`

### RSS Feed
- **Endpoint**: `/rss.xml`
- **Content**: 20 most recent papers with AI-generated summaries
- **Format**: RSS 2.0 with full TL;DR, key contributions, and methods
- **Cache**: 1-hour TTL via Cloudflare KV
- **Use Case**: Subscribe in your RSS reader to stay updated on new papers
- **Example**: `https://arxiv-explorer.yourdomain.com/rss.xml`

### Paper Comparison
- **Route**: `/compare?ids=id1,id2,id3`
- **Capacity**: 1-4 papers side-by-side
- **Sections**: TL;DR, Key Contributions, Methods, Limitations, Technical Summary
- **Layout**: Responsive grid adapts to paper count
- **Example**: `/compare?ids=2605.30353,2302.13971,2303.08774`

## Testing

### Integration Tests
```bash
cd scripts
./test-integration.sh      # Core functionality tests
./test-new-features.sh     # New features tests
./test-full.sh             # Comprehensive test suite
```

### Stress Testing
```bash
cd scripts
./test-stress.sh           # Production load testing
```

### API Deep Testing
```bash
cd scripts
./test-api-deep.sh         # Deep API endpoint testing
```

## CLI Tool for AI Assistants

A command-line interface designed for AI assistants (Claude Code, ChatGPT, etc.) to programmatically search and explore papers.

### Installation

```bash
# Quick install
./install-cli.sh

# Manual
cd cli
npm run build
npm link
```

### Usage

```bash
# Search papers
arxiv-cli search "transformer attention" 5

# Get paper details with AI summary
arxiv-cli paper 2605.30353

# Show trending papers
arxiv-cli trending 10

# Browse topics
arxiv-cli topics
arxiv-cli topic large-language-models 20

# Author papers
arxiv-cli author "Yann LeCun" 10
```

### Output Format

Clean, structured text optimized for AI parsing:

```
ID: 2605.30353
Title: Physics Is All You Need...
Authors: John Doe, Jane Smith...
Published: 2026-06-03
Categories: cs.LG, cs.AI
TL;DR: This paper introduces...
URL: https://arxiv.org/abs/2605.30353
```

See `cli/README.md` for complete documentation.

## Troubleshooting

### Check paper counts

```bash
npx wrangler d1 execute arxiv-explorer --remote --config wrangler.api.toml \
  --command="SELECT summary_ready, COUNT(*) as cnt FROM papers GROUP BY summary_ready"
```

### Retry pending/failed papers locally

```bash
# Retry up to 50 papers
ADMIN_SECRET=<secret> LIMIT=50 npx tsx scripts/retry-failed-local.ts

# Process with higher concurrency (careful with GPU memory)
ADMIN_SECRET=<secret> LIMIT=100 CONCURRENCY=2 npx tsx scripts/retry-failed-local.ts
```

### Push local DB to remote

```bash
ADMIN_SECRET=<secret> npx tsx scripts/push-local-to-remote.ts
```

### Watch live logs

```bash
wrangler tail arxiv-api    --format=pretty   # API worker
wrangler tail arxiv-ingest --format=pretty   # Ingest worker
```

### Sync remote DB to local

```bash
npx tsx scripts/sync-remote-to-local.ts
```

### Reset database

```bash
./scripts/reset-and-ingest.sh
```

## Design Notes

### Why Worker instead of Pages

Deploying the Next.js frontend as a Cloudflare Worker (via OpenNext `main` + `assets`) rather than Cloudflare Pages avoids the per-request nonce that Pages unconditionally injects into `script-src`. That injection happens at the CDN layer before the response reaches the browser, so no amount of middleware or `_headers` file can override it. The Worker deployment has no such injection and serves the app's own CSP intact.

The deployment uses:
- `@opennextjs/cloudflare` adapter
- OpenNext build: `npx opennextjs-cloudflare build`
- Output: `.open-next/worker.js` + `.open-next/assets/`
- Wrangler config: `wrangler.jsonc` with `main` and `assets` bindings

### Search Algorithm

1. Normalise query
2. Check KV cache (2 h TTL)
3. Parallel:
   - D1 FTS keyword search (BM25, title boosted 10:1:5)
   - Vectorize semantic search (query embedding cached 24 h)
4. Merge (25 % keyword · 75 % semantic), deduplicate
5. Return top 10, write to KV

### Caching Strategy

- **Lazy KV writes**: paper detail written to KV on first access, not at ingestion
- **Query embedding cache**: popular search vectors cached 24 h in KV
- **Trending KV cache**: 60-minute TTL, auto-invalidated on new papers

### AI Processing

- Single consolidated prompt per paper → structured JSON output
- Workers AI uses `@cf/meta/llama-3.1-8b-instruct` for summaries, `@cf/baai/bge-base-en-v1.5` for embeddings
- Local Ollama fallback: `gemma4:e4b` (summaries) + `nomic-embed-text` (embeddings)
- Failed papers marked `summary_ready = 2` and retried on next run


## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the **Business Source License 1.1 (BSL 1.1)**.

- ✅ Free for personal, academic, and non-commercial use
- ❌ Commercial use requires a separate license
- 📅 Converts to **MIT License** on **2029-06-01**

See [LICENSE.md](LICENSE.md) for full terms, or [contact the author](https://teycirbensoltane.tn) for commercial licensing.

## Acknowledgments

- [arXiv](https://arxiv.org) for open access to research papers
- [Cloudflare](https://cloudflare.com) for the edge platform
- [Next.js](https://nextjs.org) / [OpenNext](https://opennext.js.org) for the framework + Worker adapter
- [Ollama](https://ollama.com) for local model inference
- [SeekYou](https://github.com/Teycir/SeekYou) for BackgroundBeams, DecryptedText, and AnimatedTagline components

---

<!-- related-projects:start -->
## 🌐 Related Projects

Explore more privacy-first and security tools:

### Privacy & Encryption
- **[Timeseal](https://github.com/Teycir/Timeseal)** - Time-locked encryption vault with Dead Man's Switch. AES-256 split-key crypto, ephemeral seals.
- **[Sanctum](https://github.com/Teycir/Sanctum)** - Zero-trust encrypted vault with cryptographic plausible deniability. XChaCha20-Poly1305, Argon2id.
- **[GhostChat](https://github.com/Teycir/GhostChat)** - True P2P encrypted chat via WebRTC. No servers, no storage, self-destructing messages.
- **[xmrproof](https://github.com/Teycir/xmrproof)** - Monero payment verification, 100% client-side.
- **[GhostReceipt](https://github.com/Teycir/GhostReceipt)** - Anonymous receipt generation with zero-knowledge proofs.

### Security Tools
- **[BurpAPISecuritySuite](https://github.com/Teycir/BurpAPISecuritySuite)** - Burp Suite extension for API security testing. 15 attack types, 108+ payloads, BOLA/IDOR detection.
- **[Mcpwn](https://github.com/Teycir/Mcpwn)** - Automated security scanner for Model Context Protocol servers. Detects RCE, path traversal, prompt injection.
- **[DiffCatcher](https://github.com/Teycir/DiffCatcher)** - Git repo discovery, diff capture, code element extraction.
- **[HoneypotScan](https://github.com/Teycir/HoneypotScan)** - Honeypot detection service for security research.
- **[CheckAPI](https://github.com/Teycir/CheckAPI)** - LLM API key validator for multiple providers. Privacy-first, client-side validation.
- **[SeekYou](https://github.com/Teycir/SeekYou)** - Host intelligence aggregator — unified OSINT across 15 sources for IPs, domains, and ASNs.

### MCP Security Servers
- **[burp-mcp-server](https://github.com/Teycir/burp-mcp-server)** - MCP server for Burp Suite Professional. Vulnerability scanning via AI assistants.
- **[nuclei-mcp](https://github.com/Teycir/nuclei-mcp)** - MCP server for Nuclei. Multi-target scanning, severity filtering.
- **[nmap-mcp](https://github.com/Teycir/nmap-mcp)** - MCP server for Nmap. Stealth recon, vuln/NSE scanning.
- **[frida-mcp](https://github.com/Teycir/frida-mcp)** - MCP server for Frida. Dynamic instrumentation, SSL pinning bypass.
<!-- related-projects:end -->

---

<!-- services:start -->
## 💼 Services Offered

- 🔒 **Privacy-First Development** - P2P applications, encrypted communication, zero-knowledge systems
- 🚀 **Web Application Development** - Full-stack development with Next.js, React, TypeScript
- 🔧 **Edge Computing Solutions** - Cloudflare Workers, Pages, D1, KV, Durable Objects
- 🛡️ **Security Tool Development** - Burp extensions, penetration testing tools, automation frameworks
- 🤖 **AI Integration** - LLM-powered applications, intelligent automation, custom AI solutions
- 🔍 **OSINT & Threat Intelligence** - Custom reconnaissance tools, threat feed aggregation, IOC correlation

**Get in Touch**: [teycirbensoltane.tn](https://teycirbensoltane.tn) | Available for freelance projects and consulting
<!-- services:end -->

---

<!-- attribution:start -->
<div align="center">

**Built with 💚 by [Teycir Ben Soltane](https://teycirbensoltane.tn)**

</div>
<!-- attribution:end -->
