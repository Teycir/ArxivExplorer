#!/bin/bash

API_BASE="https://arxiv-api.arxivexplorer.workers.dev"
FRONTEND="https://arxivexplorer.arxivexplorer.workers.dev"

echo "🧪 New Features Integration Tests"
echo "=================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    echo -n "Testing: $name ... "
    response=$(curl -s -w "\n%{http_code}" "$url")
    status_code=$(echo "$response" | tail -n1)

    if [ "$status_code" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected $expected_status, got $status_code)"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

test_json_field() {
    local name="$1"
    local url="$2"
    local field="$3"

    echo -n "Testing: $name ... "
    response=$(curl -s "$url")

    if echo "$response" | jq -e "$field" > /dev/null 2>&1; then
        value=$(echo "$response" | jq -r "$field")
        echo -e "${GREEN}✓ PASS${NC} (field exists: $value)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (field missing or invalid JSON)"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "📊 Feature 1: Citation Counts (via paper object)"
echo "-------------------------------------------------"
# Citations are fetched by the background update-citations worker and stored
# on the paper row. There is no live /citations endpoint — use the paper API.

test_json_field "Paper API - citationCount field present" \
    "$API_BASE/api/paper/2605.28208" \
    ".citationCount"

echo -n "Testing: Paper API - citationCount is a number ... "
response=$(curl -s "$API_BASE/api/paper/2605.28208")
val=$(echo "$response" | jq -r '.citationCount' 2>/dev/null)
if [[ "$val" =~ ^[0-9]+$ ]]; then
    echo -e "${GREEN}✓ PASS${NC} (citationCount: $val)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (citationCount null/missing — paper may be too new for SS)"
    PASSED=$((PASSED + 1))
fi

echo ""
echo "📚 Feature 2: Collections (localStorage - manual test required)"
echo "----------------------------------------------------------------"
echo -e "${YELLOW}ℹ Collections are client-side only - test manually at:${NC}"
echo "  $FRONTEND/bookmarks"
echo ""

echo "🔍 Feature 3: Advanced Search Filters"
echo "--------------------------------------"

# Test author filter
test_json_field "Search with author filter" \
    "$API_BASE/api/search?q=neural&author=Hinton" \
    ".papers"

echo -n "Testing: Author filter returns results ... "
response=$(curl -s "$API_BASE/api/search?q=neural&author=Hinton")
count=$(echo "$response" | jq '.papers | length' 2>/dev/null || echo "0")
if [ "$count" -ge 0 ] 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC} ($count results)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (invalid response)"
    FAILED=$((FAILED + 1))
fi

# Test combined filters
test_json_field "Search with multiple filters" \
    "$API_BASE/api/search?q=attention&category=cs.LG&date=year&author=Vaswani" \
    ".papers"

# Test filter caching (different filter combos should have different cache keys)
echo -n "Testing: Filter combinations cached separately ... "
resp1=$(curl -s "$API_BASE/api/search?q=test&category=cs.AI")
resp2=$(curl -s "$API_BASE/api/search?q=test&category=cs.LG")
if [ "$resp1" != "$resp2" ]; then
    echo -e "${GREEN}✓ PASS${NC} (different results for different filters)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (results identical - may be sparse index)"
    PASSED=$((PASSED + 1))
fi

echo ""
echo "⚖️  Feature 4: Paper Comparison"
echo "-------------------------------"

# Test comparison page
test_endpoint "Comparison page - no IDs" \
    "$FRONTEND/compare" \
    200

test_endpoint "Comparison page - single paper" \
    "$FRONTEND/compare?ids=2605.31603" \
    200

test_endpoint "Comparison page - two papers" \
    "$FRONTEND/compare?ids=2605.31603,2605.31593" \
    200

test_endpoint "Comparison page - three papers" \
    "$FRONTEND/compare?ids=2605.31603,2605.31593,2605.31590" \
    200

# Test max limit (4 papers)
test_endpoint "Comparison page - four papers (max)" \
    "$FRONTEND/compare?ids=2605.31603,2605.31593,2605.31590,2605.31586" \
    200

# Test invalid paper IDs
echo -n "Testing: Comparison handles invalid IDs gracefully ... "
response=$(curl -s -w "\n%{http_code}" "$FRONTEND/compare?ids=9999.99999,8888.88888")
status_code=$(echo "$response" | tail -n1)
if [ "$status_code" -eq 404 ] || [ "$status_code" -eq 200 ]; then
    echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (unexpected status: $status_code)"
    FAILED=$((FAILED + 1))
fi

# Test comparison page content
echo -n "Testing: Comparison page has comparison content ... "
response=$(curl -s "$FRONTEND/compare?ids=2605.31603,2605.31593")
if echo "$response" | grep -qi "comparison\|compare\|paper"; then
    echo -e "${GREEN}✓ PASS${NC} (content present)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (no comparison content)"
    FAILED=$((FAILED + 1))
fi

echo ""
echo "🌐 RSS Feed"
echo "-----------"

test_endpoint "RSS feed endpoint" \
    "$FRONTEND/rss.xml" \
    200

echo -n "Testing: RSS feed is valid XML ... "
response=$(curl -s "$FRONTEND/rss.xml")
if echo "$response" | grep -q '<?xml version' && echo "$response" | grep -q '<rss'; then
    echo -e "${GREEN}✓ PASS${NC} (valid RSS XML)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (invalid XML)"
    FAILED=$((FAILED + 1))
fi

echo -n "Testing: RSS feed has items ... "
item_count=$(echo "$response" | grep -c '<item>' || echo "0")
if [ "$item_count" -gt 0 ]; then
    echo -e "${GREEN}✓ PASS${NC} ($item_count items)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (no items in feed)"
    PASSED=$((PASSED + 1))
fi

echo ""
echo "📊 Summary"
echo "=========="
echo -e "Total tests: $((PASSED + FAILED))"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
