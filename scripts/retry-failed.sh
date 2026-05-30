#!/bin/bash
# Reset failed papers (summary_ready=2) back to pending (summary_ready=0)
# This allows them to be retried with the improved error handling

echo "=== Resetting Failed Papers for Retry ==="
npx wrangler d1 execute arxiv-explorer --remote --command="
UPDATE papers 
SET summary_ready = 0 
WHERE summary_ready = 2
"

echo ""
echo "=== Updated Status ==="
npx wrangler d1 execute arxiv-explorer --remote --command="
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN summary_ready = 0 THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN summary_ready = 1 THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN summary_ready = 2 THEN 1 ELSE 0 END) as failed
FROM papers
"

echo ""
echo "✅ Failed papers reset to pending. They will be retried on the next cron run."
echo "To trigger immediately, run: curl -X POST https://arxiv-ingest.arxivexplorer.workers.dev/trigger"
