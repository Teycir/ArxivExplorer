#!/bin/bash
# Waits for arXiv to unblock, then runs a single ingest for all thin-topic categories.
# All thin topics in one run: cs.CR (Crypto), cs.NI (Networking), cs.SD/eess.AS/eess.SP (Speech),
# cs.MM (Multimedia/Multimodal), cs.NE (Neural Arch), cs.OS (OS), cs.PL (Prog Synthesis),
# cs.CC (Complexity), cs.DC (Distributed), cs.DM (Algorithms/DM), cs.DS (Algorithms/DS),
# cs.IT (Info Theory)

REPO=/home/teycir/Repos/ArxivExplorer
LOG=$REPO/ingest-thin.log
WATCHER_LOG=$REPO/wait-thin.log
CATS="cs.CR,cs.NI,cs.SD,eess.AS,eess.SP,cs.MM,cs.NE,cs.OS,cs.PL,cs.CC,cs.DC,cs.DM,cs.DS,cs.IT"
DAYS=90
PROBE_URL="http://export.arxiv.org/api/query?search_query=cat:cs.CR&max_results=1"
INITIAL_WAIT=300   # 5 min silence before first probe
PROBE_INTERVAL=120 # probe every 2 min after that

echo "[$(date -u +%H:%M:%S)] Waiting ${INITIAL_WAIT}s before first probe..." | tee "$WATCHER_LOG"
sleep $INITIAL_WAIT

while true; do
  RESP=$(curl -s --max-time 10 "$PROBE_URL" 2>/dev/null)
  if echo "$RESP" | grep -q "<feed"; then
    echo "[$(date -u +%H:%M:%S)] arXiv is clear! Launching ingest..." | tee -a "$WATCHER_LOG"
    notify-send "arXiv Unblocked" "Starting thin-topic ingest now..." -u normal -t 5000 2>/dev/null || true
    cd "$REPO" && npm run ingest -- --days $DAYS --categories $CATS > "$LOG" 2>&1
    EXIT=$?
    echo "[$(date -u +%H:%M:%S)] Ingest finished (exit $EXIT)" | tee -a "$WATCHER_LOG"
    notify-send "arXiv Ingest Done" "$(tail -4 $LOG)" -u normal -t 15000 2>/dev/null || true
    printf '\x07'  # terminal bell
    break
  else
    echo "[$(date -u +%H:%M:%S)] Still blocked. Next probe in ${PROBE_INTERVAL}s..." | tee -a "$WATCHER_LOG"
    sleep $PROBE_INTERVAL
  fi
done
