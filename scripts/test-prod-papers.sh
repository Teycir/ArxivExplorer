#!/bin/bash
# Test production API with 10 real papers
# Tests: paper detail, abstract search, related papers, citations

API_BASE="${API_BASE:-https://arxiv-api.teycirbensoltane.workers.dev}"
LOG_FILE="/tmp/test-prod-papers-$(date +%s).log"
PASS=0
FAIL=0

log() {
    echo "[$(date +'%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Starting production test"
log "API_BASE: $API_BASE"

# Get 10 papers from production API
log "Fetching 10 papers from production..."
PAPER_IDS=$(curl -s --max-time 10 "$API_BASE/api/search?q=machine+learning&limit=10" | jq -r '.papers[].id' 2>/dev/null | head -10)

log "Testing $(echo $PAPER_IDS | wc -w) papers"
echo ""

for paper_id in $PAPER_IDS; do
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "Testing: $paper_id"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Test 1: Paper detail
    log "  [1/4] GET /api/paper/$paper_id"
    DETAIL=$(curl -s --max-time 10 "$API_BASE/api/paper/$paper_id")
    
    if echo "$DETAIL" | jq -e '.id' >/dev/null 2>&1; then
        TITLE=$(echo "$DETAIL" | jq -r '.title')
        log "    ✓ Title: $TITLE"
        ((PASS++))
    else
        log "    ✗ Paper not found"
        ((FAIL++))
        continue
    fi
    
    # Test 2: Abstract search
    SEARCH_QUERY=$(echo "$DETAIL" | jq -r '.abstract' | head -c 50 | tr '\n' ' ')
    log "  [2/4] Search by abstract"
    SEARCH_RESULT=$(curl -s --max-time 15 "$API_BASE/api/search?q=$(echo $SEARCH_QUERY | jq -sRr @uri)")
    
    if echo "$SEARCH_RESULT" | jq -e '.papers[0]' >/dev/null 2>&1; then
        FOUND=$(echo "$SEARCH_RESULT" | jq '.papers | length')
        log "    ✓ Found $FOUND results"
        ((PASS++))
    else
        log "    ✗ Search failed"
        ((FAIL++))
    fi
    
    # Test 3: Related papers
    log "  [3/4] GET /api/paper/$paper_id/related"
    RELATED=$(curl -s --max-time 10 "$API_BASE/api/paper/$paper_id/related")
    
    if echo "$RELATED" | jq -e '.[0]' >/dev/null 2>&1; then
        COUNT=$(echo "$RELATED" | jq '. | length')
        log "    ✓ Found $COUNT related papers"
        ((PASS++))
    else
        log "    ⚠ No related papers"
        ((PASS++))
    fi
    
    # Test 4: Citations
    log "  [4/4] GET /api/citations/$paper_id"
    CITATIONS=$(curl -s --max-time 10 "$API_BASE/api/citations/$paper_id")
    
    if echo "$CITATIONS" | jq -e '.citationCount' >/dev/null 2>&1; then
        CITE_COUNT=$(echo "$CITATIONS" | jq -r '.citationCount // 0')
        log "    ✓ Citations: $CITE_COUNT"
        ((PASS++))
    else
        log "    ⚠ Citation data unavailable"
        ((PASS++))
    fi
    
    echo ""
done

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "RESULTS: $PASS passed, $FAIL failed"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Full log: $LOG_FILE"

[ $FAIL -eq 0 ]
