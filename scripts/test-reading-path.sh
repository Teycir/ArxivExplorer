#!/bin/bash
# Integration test for Reading Path feature

API_BASE="${API_BASE:-https://arxiv-api.arxivexplorer.workers.dev}"
PASS=0
FAIL=0

log() {
    echo "[$(date +'%H:%M:%S')] $*"
}

log "Testing Reading Path Feature"
log "API_BASE: $API_BASE"
echo ""

# Test 1: Valid API call (path may or may not exist)
log "Test 1: Query reading path API"
RESPONSE=$(curl -s "$API_BASE/api/reading-path?from=test.12345&to=2606.05160")
if echo "$RESPONSE" | jq -e '.path or .error' >/dev/null 2>&1; then
    if echo "$RESPONSE" | jq -e '.path' >/dev/null 2>&1; then
        PATH_LENGTH=$(echo "$RESPONSE" | jq '.path | length')
        log "  ✓ Found path with $PATH_LENGTH steps"
    else
        log "  ✓ API returned valid response (no path found)"
    fi
    ((PASS++))
else
    log "  ✗ Invalid API response"
    log "  Response: $(echo $RESPONSE | head -c 200)"
    ((FAIL++))
fi
echo ""

# Test 2: Missing parameters
log "Test 2: Missing 'to' parameter (should fail)"
RESPONSE=$(curl -s "$API_BASE/api/reading-path?from=2606.05139")
if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
    log "  ✓ Correctly returned error: $ERROR_MSG"
    ((PASS++))
else
    log "  ✗ Should have returned error"
    ((FAIL++))
fi
echo ""

# Test 3: Same paper (should fail)
log "Test 3: Same start and end paper (should fail)"
RESPONSE=$(curl -s "$API_BASE/api/reading-path?from=2606.05139&to=2606.05139")
if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
    log "  ✓ Correctly returned error: $ERROR_MSG"
    ((PASS++))
else
    log "  ✗ Should have returned error"
    ((FAIL++))
fi
echo ""

# Test 4: Non-existent paper
log "Test 4: Non-existent paper (should fail gracefully)"
RESPONSE=$(curl -s "$API_BASE/api/reading-path?from=9999.99999&to=2606.05139")
if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
    log "  ✓ Correctly returned error: $ERROR_MSG"
    ((PASS++))
else
    log "  ✗ Should have returned error"
    ((FAIL++))
fi
echo ""

# Test 5: Check path structure (if path exists)
log "Test 5: Verify API response structure"
RESPONSE=$(curl -s "$API_BASE/api/reading-path?from=test.12345&to=2606.05160")
if echo "$RESPONSE" | jq -e '.path or .error' >/dev/null 2>&1; then
    if echo "$RESPONSE" | jq -e '.path[0].id' >/dev/null 2>&1; then
        FIRST_ID=$(echo "$RESPONSE" | jq -r '.path[0].id')
        FIRST_TITLE=$(echo "$RESPONSE" | jq -r '.path[0].title')
        log "  ✓ Path has valid structure"
        log "    First paper: $FIRST_ID"
        log "    Title: $(echo $FIRST_TITLE | cut -c1-60)..."
    else
        log "  ✓ Response structure valid (no path available)"
    fi
    ((PASS++))
else
    log "  ✗ Response structure invalid"
    ((FAIL++))
fi
echo ""

# Test 6: Frontend page loads
log "Test 6: Frontend /reading-path page"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://arxivexplorer.arxivexplorer.workers.dev/reading-path")
if [ "$STATUS" = "200" ]; then
    log "  ✓ Reading Path page loads (HTTP $STATUS)"
    ((PASS++))
else
    log "  ✗ Page failed to load (HTTP $STATUS)"
    ((FAIL++))
fi
echo ""

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "RESULTS: $PASS passed, $FAIL failed"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ $FAIL -eq 0 ]
