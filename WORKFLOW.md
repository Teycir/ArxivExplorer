# ArxivExplorer - Single Ingestion Workflow

## The Only Way to Process Data

### 1. Ingest Papers with Ollama (Local)

```bash
# Fetch papers from ALL 40 CS categories
npm run ingest -- --days 7

# Or specify more days
npm run ingest -- --days 14
```

**What it does:**
- Fetches from ALL 40 CS categories automatically
- 5-second delay between each arXiv API request (conservative)
- Processes ONE paper at a time (no parallel)
- Generates summaries with Ollama (qwen3.5:4b)
- Generates embeddings with Ollama (nomic-embed-text)
- Skips duplicates automatically
- Stores in local D1 database

**Time:** 2-4 hours depending on number of papers

### 2. Export Local Database

```bash
npm run db:export
```

Creates `backup.sql` with all papers, summaries, and embeddings.

### 3. Push to Cloudflare

```bash
npm run db:push
```

Uploads database to Cloudflare D1 (production).

### 4. Upload Embeddings to Vectorize

```bash
npm run upload-embeddings
```

Uploads all embeddings to Cloudflare Vectorize for semantic search.

### 5. Deploy Frontend & API

```bash
npm run deploy
npm run deploy:api
npm run deploy:ingest
```

### 6. Test

```bash
bash test-integration.sh
```

## Complete Workflow

```bash
# 1. Ingest (wait 2-4 hours)
npm run ingest -- --days 7

# 2. Export
npm run db:export

# 3. Push to production
npm run db:push

# 4. Upload embeddings
npm run upload-embeddings

# 5. Deploy (if needed)
npm run deploy
npm run deploy:api

# 6. Test
bash test-integration.sh
```

## Check Status

```bash
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite \
  "SELECT COUNT(*) as total, SUM(CASE WHEN summary_ready = 1 THEN 1 ELSE 0 END) as ready FROM papers"
```

## Important Notes

- **Rate Limits**: arXiv API has rate limits. If you get 429 errors, wait a few hours.
- **Conservative**: The script uses 5-second delays to avoid rate limits.
- **Sequential**: No parallel processing to ensure stability.
- **Ollama Required**: Make sure Ollama is running with models installed.
- **All Categories**: Always fetches from all 40 CS categories.

## Files

- `scripts/bulk-ingest.ts` - The only ingestion script
- `scripts/upload-embeddings.ts` - Upload embeddings to Vectorize
- `test-integration.sh` - Integration tests

That's it. One way to do everything.
