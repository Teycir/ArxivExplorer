#!/bin/bash
# Complete fix workflow: reset failed papers and trigger reprocessing

set -e

echo "🔧 ArXiv Explorer - Summary Failure Fix"
echo "========================================"
echo ""

# Step 1: Show current status
echo "📊 Current Status:"
npx wrangler d1 execute arxiv-explorer --remote --command="
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN summary_ready = 0 THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN summary_ready = 1 THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN summary_ready = 2 THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN summary_ready = 2 THEN 1 ELSE 0 END) / COUNT(*), 2) as failure_rate_pct
FROM papers
" | grep -A 20 "results"

echo ""
echo "🔄 Resetting failed papers to pending..."
npx wrangler d1 execute arxiv-explorer --remote --command="
UPDATE papers SET summary_ready = 0 WHERE summary_ready = 2
" > /dev/null 2>&1

echo "✅ Reset complete"
echo ""

# Step 2: Trigger reprocessing
echo "🚀 Triggering immediate reprocessing..."
RESPONSE=$(curl -s -X POST https://arxiv-ingest.arxivexplorer.workers.dev/trigger)
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

echo ""
echo "✅ Processing triggered"
echo ""
echo "📝 Next steps:"
echo "  1. Wait 2-3 minutes for processing to complete"
echo "  2. Run: ./scripts/check-failures.sh"
echo "  3. Monitor logs: wrangler tail arxiv-ingest --format=pretty"
echo ""
echo "Expected improvement: failure rate should drop from 65% to <10%"
