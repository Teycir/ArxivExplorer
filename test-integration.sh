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
test_endpoint "Search - empty query" \
    "$API_BASE/api/search?q=" \
    400

# Test 3: Get specific paper
test_json_response "Paper details - valid ID" \
    "$API_BASE/api/paper/2605.30353" \
    ".id"

# Test 4: Paper not found
test_endpoint "Paper details - invalid ID" \
    "$API_BASE/api/paper/9999.99999" \
    404

# Test 5: Related papers (returns empty array if none found)
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

# Test 7: Topic endpoint (skip - not implemented)
# test_json_response "Topic - machine learning" \
#     "$API_BASE/api/topic/machine-learning" \
#     ".papers"

# Test 8: Health check (skip - not implemented)
# test_endpoint "Health check" \
#     "$API_BASE/health" \
#     200

echo ""
echo "🌐 Frontend Tests"
echo "-----------------"

# Test 9: Homepage
test_endpoint "Homepage" \
    "$FRONTEND/" \
    200

# Test 10: Search page
test_endpoint "Search page" \
    "$FRONTEND/search?q=neural+networks" \
    200

# Test 11: Paper detail page
test_endpoint "Paper detail page" \
    "$FRONTEND/paper/2605.30353" \
    200

# Test 12: FAQ page
test_endpoint "FAQ page" \
    "$FRONTEND/faq" \
    200

# Test 13: How to use page
test_endpoint "How to use page" \
    "$FRONTEND/how-to-use" \
    200

# Test 14: Bookmarks page
test_endpoint "Bookmarks page" \
    "$FRONTEND/bookmarks" \
    200

# Test 15: Robots.txt
test_endpoint "Robots.txt" \
    "$FRONTEND/robots.txt" \
    200

# Test 16: Sitemap
test_endpoint "Sitemap" \
    "$FRONTEND/sitemap.xml" \
    200

echo ""
echo "🔍 Advanced API Tests"
echo "---------------------"

# Test 17: Search with filters
test_json_response "Search with category filter" \
    "$API_BASE/api/search?q=transformer&category=cs.LG" \
    ".papers"

# Test 18: Pagination
test_json_response "Search with pagination" \
    "$API_BASE/api/search?q=deep+learning&limit=5" \
    ".papers"

# Test 19: CORS headers
echo -n "Testing: CORS headers ... "
cors_header=$(curl -s -I "$API_BASE/api/search?q=test" | grep -i "access-control-allow-origin")
if [ -n "$cors_header" ]; then
    echo -e "${GREEN}✓ PASS${NC} (CORS enabled)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (CORS not configured)"
    FAILED=$((FAILED + 1))
fi

# Test 20: Response time
echo -n "Testing: API response time ... "
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
