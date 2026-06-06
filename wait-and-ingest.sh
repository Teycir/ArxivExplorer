#!/bin/bash
# Polls export.arxiv.org every 5 minutes (single probe, 8s timeout).
# Fires bulk-ingest the moment a valid XML response arrives.
cd /home/teycir/Repos/ArxivExplorer

echo "$(date) — silent wait: making NO requests for 15 minutes first..."
sleep 900

echo "$(date) — starting to probe export.arxiv.org every 5 minutes..."

attempt=0
while true; do
  attempt=$((attempt + 1))
  STATUS=$(curl -s --max-time 8 "https://export.arxiv.org/api/query?search_query=cat:cs.CC&max_results=1" 2>&1)
  if echo "$STATUS" | grep -qE "<entry|totalResults|<feed|opensearch"; then
    echo "$(date) — ✅ arXiv clear after ${attempt} probe(s). Launching ingest..."
    break
  else
    echo "$(date) — ⏳ probe ${attempt}: still blocked (${STATUS:0:50})"
    sleep 300
  fi
done

sleep 5
nohup npx tsx scripts/bulk-ingest.ts \
  --days 90 \
  --categories cs.CC,cs.DC,cs.DM,cs.DS,cs.IT,cs.NE,cs.NI,cs.OS,cs.PL,eess.AS,eess.SP \
  >> /home/teycir/Repos/ArxivExplorer/ingest-thin.log 2>&1 &

echo "$(date) — ingest launched, PID: $!"
