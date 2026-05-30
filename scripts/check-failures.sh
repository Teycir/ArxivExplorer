#!/bin/bash
# Check paper processing status and failure rates

echo "=== Paper Processing Status ==="
npx wrangler d1 execute arxiv-explorer --remote --command="
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN summary_ready = 0 THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN summary_ready = 1 THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN summary_ready = 2 THEN 1 ELSE 0 END) as failed
FROM papers
"

echo ""
echo "=== Failure Rate ==="
npx wrangler d1 execute arxiv-explorer --remote --command="
SELECT 
  ROUND(100.0 * SUM(CASE WHEN summary_ready = 2 THEN 1 ELSE 0 END) / COUNT(*), 2) as failure_rate_pct
FROM papers
"

echo ""
echo "=== Recent Failed Papers (last 10) ==="
npx wrangler d1 execute arxiv-explorer --remote --command="
SELECT id, title, indexed_at
FROM papers
WHERE summary_ready = 2
ORDER BY indexed_at DESC
LIMIT 10
"

echo ""
echo "=== Papers by Category ==="
npx wrangler d1 execute arxiv-explorer --remote --command="
SELECT 
  json_extract(categories, '$[0]') as primary_category,
  COUNT(*) as total,
  SUM(CASE WHEN summary_ready = 1 THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN summary_ready = 2 THEN 1 ELSE 0 END) as failed
FROM papers
GROUP BY primary_category
ORDER BY total DESC
"
