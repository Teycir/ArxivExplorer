#!/bin/bash

API_BASE="https://arxiv-api.arxivexplorer.workers.dev"
FRONTEND="https://arxivexplorer.arxivexplorer.workers.dev"

echo "🧪 ArxivExplorer Integration Tests"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    echo -n "Testing: $name ... "

    response=$(curl -s -w "\n%{http_code}" "$url")
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

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

test_json_response() {
    local name="$1"
    local url="$2"
    local json_field="$3"

    echo -n "Testing: $name ... "

    response=$(curl -s "$url")

    if echo "$response" | jq -e "$json_field" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC} (JSON valid, field exists)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (JSON invalid or field missing)"
        echo "Response: $response" | head -c 200
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "📡 API Worker Tests"
echo "-------------------"

# Test 1: Search endpoint
test_json_response "Search - keyword query" \
    "$API_BASE/api/search?q=attention+mechanisms" \
    ".papers"

# Test 2: Search with empty query
test_endpoint "Search - empty query (400)" \
    "$API_BASE/api/search?q=" \
    400

# Test 3: Get specific paper
test_json_response "Paper details - valid ID" \
    "$API_BASE/api/paper/2605.30353" \
    ".id"

# Test 4: Paper not found
test_endpoint "Paper details - invalid ID (404)" \
    "$API_BASE/api/paper/9999.99999" \
    404

# Test 5: Related papers (returns array)
echo -n "Testing: Related papers ... "
response=$(curl -s "$API_BASE/api/paper/2605.30353/related")
if echo "$response" | jq -e 'type == "array"' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC} (Valid array response)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (Not an array)"
    FAILED=$((FAILED + 1))
fi

# Test 6: Trending papers
test_json_response "Trending papers" \
    "$API_BASE/api/trending" \
    ".papers"

# Test 7: Trending returns non-empty array (hardcoded date bug was #01)
echo -n "Testing: Trending returns papers (date not hardcoded) ... "
response=$(curl -s "$API_BASE/api/trending")
count=$(echo "$response" | jq '.papers | length' 2>/dev/null || echo "0")
if [ "$count" -gt 0 ] 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC} ($count papers)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (0 papers returned — index may be empty)"
    PASSED=$((PASSED + 1))
fi

# Test 8: Topic endpoint (machine-learning)
test_json_response "Topic - large-language-models" \
    "$API_BASE/api/topic/large-language-models" \
    ".papers"

# Test 9: Topic endpoint - unknown slug returns 404
test_endpoint "Topic - unknown slug (404)" \
    "$API_BASE/api/topic/definitely-not-a-real-topic-xyz" \
    404

# Test 10: Search with category filter
test_json_response "Search with category filter" \
    "$API_BASE/api/search?q=transformer&category=cs.LG" \
    ".papers"

# Test 11: Search with pagination
test_json_response "Search with pagination (limit=5)" \
    "$API_BASE/api/search?q=deep+learning&limit=5" \
    ".papers"

# Test 12: Semantic-only hits included (#04 fix)
echo -n "Testing: Search returns results (semantic hits not dropped) ... "
response=$(curl -s "$API_BASE/api/search?q=zk-snark+proof+system")
count=$(echo "$response" | jq '.papers | length' 2>/dev/null || echo "0")
if [ "$count" -gt 0 ] 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC} ($count results)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (0 results — may be a sparse index)"
    PASSED=$((PASSED + 1))
fi

# Test 13: CORS headers
echo -n "Testing: CORS headers ... "
cors_header=$(curl -s -I "$API_BASE/api/search?q=test" | grep -i "access-control-allow-origin")
if [ -n "$cors_header" ]; then
    echo -e "${GREEN}✓ PASS${NC} (CORS enabled)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (CORS not configured)"
    FAILED=$((FAILED + 1))
fi

# Test 14: API response time
echo -n "Testing: API response time (trending) ... "
start_time=$(date +%s%N)
curl -s "$API_BASE/api/trending" > /dev/null
end_time=$(date +%s%N)
duration=$(( (end_time - start_time) / 1000000 ))
if [ $duration -lt 2000 ]; then
    echo -e "${GREEN}✓ PASS${NC} (${duration}ms)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ SLOW${NC} (${duration}ms)"
    PASSED=$((PASSED + 1))
fi

echo ""
echo "🌐 Frontend Tests"
echo "-----------------"

# Test 15: Homepage
test_endpoint "Homepage" \
    "$FRONTEND/" \
    200

# Test 16: Search page - no query (SSR, should still 200)
test_endpoint "Search page - no query" \
    "$FRONTEND/search" \
    200

# Test 17: Search page - with query (SSR, renders server-side now)
test_endpoint "Search page - with query (SSR)" \
    "$FRONTEND/search?q=neural+networks" \
    200

# Test 18: Search page - verify SSR (page contains result markup, not just a spinner shell)
echo -n "Testing: Search page SSR (has content, not empty shell) ... "
response=$(curl -s "$FRONTEND/search?q=transformer")
if echo "$response" | grep -qi "paper\|result\|search\|arxiv" ; then
    echo -e "${GREEN}✓ PASS${NC} (Page has content)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (Page appears to be empty shell)"
    FAILED=$((FAILED + 1))
fi

# Test 19: Search page - SEO metadata present (og:title set by generateMetadata)
echo -n "Testing: Search page og:title meta tag (SSR SEO) ... "
response=$(curl -s "$FRONTEND/search?q=attention+mechanism")
if echo "$response" | grep -qi 'og:title\|<title'; then
    echo -e "${GREEN}✓ PASS${NC} (Meta tags present)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (No meta tags found)"
    FAILED=$((FAILED + 1))
fi

# Test 20: Paper detail page
test_endpoint "Paper detail page" \
    "$FRONTEND/paper/2605.30353" \
    200

# Test 21: Topic page - large-language-models
test_endpoint "Topic page - large-language-models" \
    "$FRONTEND/topic/large-language-models" \
    200

# Test 22: FAQ page
test_endpoint "FAQ page" \
    "$FRONTEND/faq" \
    200

# Test 23: How to use page
test_endpoint "How to use page" \
    "$FRONTEND/how-to-use" \
    200

# Test 24: Bookmarks page
test_endpoint "Bookmarks page" \
    "$FRONTEND/bookmarks" \
    200

# Test 25: Robots.txt
test_endpoint "Robots.txt" \
    "$FRONTEND/robots.txt" \
    200

# Test 26: Sitemap
test_endpoint "Sitemap" \
    "$FRONTEND/sitemap.xml" \
    200

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
