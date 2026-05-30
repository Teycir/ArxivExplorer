#!/bin/bash
set -e

echo "▶ Dropping all tables..."
npx wrangler d1 execute arxiv-explorer --remote --file=migrations/0000_drop_all.sql

echo "▶ Recreating database schema..."
npx wrangler d1 execute arxiv-explorer --remote --file=migrations/0001_schema.sql

echo "▶ Waiting 5 seconds for schema to propagate..."
sleep 5

echo "▶ Triggering ingest worker..."
curl -X GET "https://arxiv-ingest.arxivexplorer.workers.dev/trigger"

echo ""
echo "✓ Done! The ingest worker is now processing papers. This will take ~10 minutes."
echo "  Check progress: npx wrangler tail arxiv-ingest"
