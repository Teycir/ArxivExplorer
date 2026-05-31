# Bulk Ingestion with Ollama

This system allows you to populate the database with ALL CS arXiv papers using Ollama locally, avoiding Cloudflare Workers AI costs for bulk operations.

## Architecture

- **Bulk ingestion**: Ollama (local) → D1 (local) → Export → D1 (production)
- **On-demand**: User searches new paper → Workers AI (free tier) → Cache

## Prerequisites

1. **Install Ollama**: https://ollama.ai
2. **Pull models**:
   ```bash
   ollama pull llama3.1:8b
   ollama pull nomic-embed-text
   ```
3. **Install Bun** (for SQLite access):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

## Workflow

### 1. Bulk Ingest Locally

Fetch and process all CS papers from the last N days:

```bash
# Fetch last 30 days, process 10 papers at a time
npm run ingest:bulk -- --days 30 --batch 10

# For initial population (last 365 days)
npm run ingest:bulk -- --days 365 --batch 5
```

This will:
- Fetch papers from all 40 CS categories
- Generate summaries using Ollama (llama3.1:8b)
- Generate embeddings using Ollama (nomic-embed-text)
- Store everything in local D1 database

**Time estimate**: ~10-15 papers/minute on M1 Mac

### 2. Export Local Database

```bash
npm run db:export
```

Creates `backup.sql` with all papers, summaries, and embeddings.

### 3. Push to Production

```bash
npm run db:push
```

Uploads the database to Cloudflare D1.

### 4. Upload Embeddings to Vectorize

```bash
npm run ingest:upload-embeddings
```

Uploads embeddings from local DB to Cloudflare Vectorize in batches.

## Complete Initial Setup

```bash
# 1. Pull Ollama models
ollama pull llama3.1:8b
ollama pull nomic-embed-text

# 2. Run migrations
npm run db:migrate

# 3. Bulk ingest (this will take hours for 365 days)
npm run ingest:bulk -- --days 365 --batch 5

# 4. Export
npm run db:export

# 5. Push to production
npm run db:push

# 6. Upload embeddings
npm run ingest:upload-embeddings

# 7. Deploy
npm run deploy
```

## Incremental Updates

Run weekly/monthly to add new papers:

```bash
# Fetch last 7 days
npm run ingest:bulk -- --days 7 --batch 10
npm run db:export
npm run db:push
npm run ingest:upload-embeddings
```

## On-Demand Search (Users)

When a user searches for a paper not in the database:

1. Frontend calls `/api/search?q=arxiv:2312.00752`
2. API worker checks D1 cache
3. If not found, fetches from arXiv API
4. Generates summary using Workers AI (free tier)
5. Caches result in KV + D1
6. Returns to user

This keeps Workers AI usage minimal while having a comprehensive database.

## Cost Comparison

### Bulk with Workers AI (❌ Expensive)
- 10,000 papers × 2 AI calls = 20,000 calls
- Exceeds free tier quickly

### Bulk with Ollama (✅ Free)
- All processing local
- Only costs: electricity
- Push to production: free (D1 writes)

### On-Demand with Workers AI (✅ Affordable)
- Only new/uncached papers
- ~100-500 calls/day
- Well within free tier (10k/day)

## Monitoring

Check ingestion progress:

```bash
# Local DB stats
bun -e "const db = require('bun:sqlite').Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite'); console.log(db.query('SELECT COUNT(*) as total, SUM(summary_ready=1) as ready FROM papers').get())"

# Production DB stats
wrangler d1 execute arxiv-explorer --remote --command="SELECT COUNT(*) as total, SUM(summary_ready=1) as ready FROM papers"
```

## Troubleshooting

### Ollama connection refused
```bash
# Start Ollama service
ollama serve
```

### Out of memory
Reduce batch size:
```bash
npm run ingest:bulk -- --days 30 --batch 3
```

### Rate limit from arXiv
The script includes 3s delays between requests. If you still hit limits, increase the delay in `bulk-ingest.ts`.

## Notes

- Embeddings are stored as BLOBs in local D1 for easy export
- Vectorize uploads happen separately after DB push
- Failed papers are marked with `summary_ready=2` for retry
- The system is idempotent: re-running won't duplicate papers
