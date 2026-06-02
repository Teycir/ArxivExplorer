#!/bin/bash
# scripts/backfill-authors-normalized.sh
# Backfills the authors_normalized column for faster author searches.

echo "🔄 Backfilling authors_normalized column..."

wrangler d1 execute arxiv-explorer --remote --command="
  UPDATE papers
  SET authors_normalized = LOWER(REPLACE(REPLACE(authors, '\"', ''), '[', ''))
  WHERE authors_normalized IS NULL
"

echo "✅ Done! authors_normalized backfilled."
