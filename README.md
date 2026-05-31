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

![License](https://img.shields.io/badge/license-MIT-neon_green?style=for-the-badge)
![Framework](https://img.shields.io/badge/Framework-Next.js%2015-neon_green?style=for-the-badge)
![Hosting](https://img.shields.io/badge/Hosting-Cloudflare%20Pages-neon_green?style=for-the-badge)
![Database](https://img.shields.io/badge/Database-Cloudflare%20D1-neon_green?style=for-the-badge)
![Vector](https://img.shields.io/badge/Vector-Cloudflare%20Vectorize-neon_green?style=for-the-badge)
![AI](https://img.shields.io/badge/AI-Workers%20AI%20%7C%20Llama%203.1-neon_green?style=for-the-badge)
![Embeddings](https://img.shields.io/badge/Embeddings-BGE%20base%20v1.5-neon_green?style=for-the-badge)
![Local](https://img.shields.io/badge/Local%20Bulk-Ollama-neon_green?style=for-the-badge)

# arXiv Explorer

> Fast semantic arXiv paper search with AI-powered summaries — no login required.

A static-first, AI-enhanced search engine for arXiv research papers. Get paper summaries in 60 seconds without waiting for live LLM calls.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yourusername/arxiv-explorer)

</div>

## Features

- **Hybrid Search** — Combines keyword (BM25) and semantic (vector) search for accurate results
- **AI Summaries** — Pre-generated summaries with TL;DR, key contributions, methods, and limitations
- **Related Papers** — Discover similar papers through semantic similarity
- **Topic Browsing** — Curated collections for popular research areas
- **Zero Latency AI** — All summaries pre-computed, served from edge cache
- **No Login Required** — Instant access to all features

## Architecture

Built on Cloudflare's edge platform for global performance:

- **Frontend**: Next.js on Cloudflare Pages
- **API**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Vector Search**: Cloudflare Vectorize
- **Cache**: Cloudflare KV
- **AI**: Workers AI (Llama 3.1 + BGE embeddings)

### System Design

```
Browser → Next.js (Pages) → API Worker → KV Cache → D1 Database
                                              ↓
                                         Vectorize
                                              ↑
                                    Ingest Worker (Cron)
                                              ↑
                                        Workers AI
```

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Wrangler CLI: `npm install -g wrangler`

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/arxiv-explorer.git
cd arxiv-explorer

# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create arxiv-explorer

# Create KV namespace
wrangler kv:namespace create CACHE

# Create Vectorize index
wrangler vectorize create arxiv-papers --dimensions=768 --metric=cosine

# Update wrangler config files with your IDs
# Edit: wrangler.api.toml, wrangler.ingest.toml, wrangler.jsonc

# Run database migrations
npm run db:migrate:remote

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your API URLs
```

### Development

```bash
# Start Next.js dev server
npm run dev

# In another terminal, start API worker
wrangler dev --config wrangler.api.toml

# In another terminal, start ingest worker
wrangler dev --config wrangler.ingest.toml
```

Visit [http://localhost:3000](http://localhost:3000)

### Deployment

```bash
# Deploy all services
./deploy.sh

# Or deploy individually:
npm run deploy          # Next.js frontend
npm run deploy:api      # API worker
npm run deploy:ingest   # Ingest worker
```

## Project Structure

```
├── app/                    # Next.js pages
│   ├── page.tsx           # Home page
│   ├── search/            # Search results
│   ├── paper/[id]/        # Paper detail
│   └── topic/[slug]/      # Topic pages
├── src/
│   ├── api-worker/        # API endpoints
│   │   ├── routes/
│   │   │   ├── search.ts  # Hybrid search
│   │   │   ├── paper.ts   # Paper details
│   │   │   └── related.ts # Related papers
│   │   └── index.ts
│   ├── ingest-worker/     # Background processing
│   │   ├── fetch-arxiv.ts
│   │   ├── generate-summary.ts
│   │   ├── generate-embedding.ts
│   │   └── pipeline.ts
│   └── shared/            # Shared types & utils
├── migrations/            # D1 database schema
└── wrangler.*.toml       # Cloudflare config
```

## API Endpoints

### Search
```
GET /api/search?q=attention+mechanisms
```

### Paper Details
```
GET /api/paper/2312.00752
```

### Related Papers
```
GET /api/paper/2312.00752/related
```

### Trending Papers
```
GET /api/trending
```

### Topics
```
GET /api/topic/graph-neural-networks
```

## Configuration

### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_API_BASE=https://arxiv-api.yourdomain.workers.dev
API_BASE=https://arxiv-api.yourdomain.workers.dev
```

### Ingestion Settings

Edit `wrangler.ingest.toml`:

```toml
[vars]
ARXIV_FETCH_CATEGORIES = "cs.LG,cs.CL,cs.CV,stat.ML"
ARXIV_FETCH_LIMIT_PER_CATEGORY = "30"
INGEST_MAX_CONCURRENT = "5"
```

## Database Schema

### Papers
- Metadata from arXiv API
- Processing status tracking
- Full-text search index

### Summaries
- TL;DR (80-120 words)
- Key contributions
- Methods & techniques
- Limitations
- Beginner explanation
- Technical summary

### Related Papers
- Pre-computed at ingestion
- Semantic similarity scores
- Ranked top-8 per paper

## Performance

- **Search**: <300ms (cached), <600ms (D1 fallback)
- **Paper Detail**: <200ms (cached), <500ms (D1 fallback)
- **Cache Hit Rate**: >85%
- **Ingestion**: 10 papers/hour (free tier), 50/hour (paid)

## Free Tier Limits

| Resource | Free Tier | Usage |
|----------|-----------|-------|
| Workers Requests | 100k/day | ~30k/day |
| KV Reads | 100k/day | ~50k/day |
| KV Writes | 1k/day | ~400/day |
| D1 Reads | 25M/month | ~2M/month |
| Workers AI | 10k neurons/day | ~4k/day |

The app is designed to run comfortably within free tier limits.

## Troubleshooting

### No Papers Showing

Check if papers have been ingested and summarized:

```bash
npx wrangler d1 execute arxiv-explorer --remote \
  --command="SELECT COUNT(*) as total, SUM(CASE WHEN summary_ready = 1 THEN 1 ELSE 0 END) as ready FROM papers"
```

If `ready = 0`, trigger ingestion:

```bash
curl -X POST https://arxiv-ingest.yourdomain.workers.dev/trigger
```

### Reset Database

```bash
./reset-and-ingest.sh
```

### Check Logs

```bash
# API worker logs
wrangler tail arxiv-api --format=pretty

# Ingest worker logs
wrangler tail arxiv-ingest --format=pretty
```

## Development Notes

### Caching Strategy

- **Lazy KV Writes**: Papers written to KV on first access, not at ingestion
- **Query Embedding Cache**: Popular searches cached for 24h
- **CDN Edge Cache**: Static pages cached globally

### AI Processing

- **1 prompt per paper**: Consolidated JSON output (not 5 separate calls)
- **Structured output**: `response_format: json_object` for reliability
- **Batch processing**: 5 concurrent papers max
- **Error handling**: Failed papers retried on next cron run

### Search Algorithm

1. Normalize query
2. Check KV cache (2h TTL)
3. Parallel execution:
   - D1 FTS keyword search (BM25 with title boosting 10:1:5)
   - Vectorize semantic search (cached embeddings)
4. Merge results (25% keyword, 75% semantic)
5. Return top 10, cache in KV

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

- arXiv for providing open access to research papers
- Cloudflare for the edge platform
- Next.js team for the framework

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/arxiv-explorer/issues)
- **Docs**: See [spec.md](spec.md) for detailed architecture
- **Troubleshooting**: See [NEXTJS_API_ISSUE.md](NEXTJS_API_ISSUE.md) for common issues

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
