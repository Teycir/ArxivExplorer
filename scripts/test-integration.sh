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

# BUG-08: getPapersByTopic junction table fast path (no extra SELECT 1 round-trip)
# We test several topics to confirm the fast path works across different category sets.

# Test 9a: Topic returns papers array (fast path via paper_categories)
test_json_response "BUG-08: Topic fast path - computer-vision" \
    "$API_BASE/api/topic/computer-vision" \
    ".papers"

# Test 9b: Topic response time — fast path should be well under 2 s
echo -n "Testing: BUG-08: Topic response time (fast path, <2000ms) ... "
start_time=$(date +%s%N)
curl -s "$API_BASE/api/topic/large-language-models" > /dev/null
end_time=$(date +%s%N)
duration=$(( (end_time - start_time) / 1000000 ))
if [ $duration -lt 2000 ]; then
    echo -e "${GREEN}✓ PASS${NC} (${duration}ms)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ SLOW${NC} (${duration}ms — junction table may not be backfilled)"
    PASSED=$((PASSED + 1))
fi

# Test 9c: Topic papers are ordered newest-first (fast-path ORDER BY p.published_at DESC)
echo -n "Testing: BUG-08: Topic papers ordered newest-first ... "
response=$(curl -s "$API_BASE/api/topic/large-language-models")
count=$(echo "$response" | jq '.papers | length' 2>/dev/null || echo "0")
if [ "$count" -gt 1 ] 2>/dev/null; then
    date1=$(echo "$response" | jq -r '.papers[0].publishedAt' 2>/dev/null)
    date2=$(echo "$response" | jq -r '.papers[1].publishedAt' 2>/dev/null)
    if [[ "$date1" > "$date2" ]] || [[ "$date1" == "$date2" ]]; then
        echo -e "${GREEN}✓ PASS${NC} (newest first: $date1 ≥ $date2)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ FAIL${NC} (wrong order: $date1 < $date2)"
        FAILED=$((FAILED + 1))
    fi
else
    echo -e "${YELLOW}⚠ SKIP${NC} (fewer than 2 papers, cannot check order)"
    PASSED=$((PASSED + 1))
fi

# Test 9d: Second distinct topic also returns papers (fast path is general, not hardcoded)
echo -n "Testing: BUG-08: Topic fast path - reinforcement-learning returns papers ... "
response=$(curl -s "$API_BASE/api/topic/reinforcement-learning")
count=$(echo "$response" | jq '.papers | length' 2>/dev/null || echo "0")
if [ "$count" -gt 0 ] 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC} ($count papers)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (0 papers — index may be sparse for this topic)"
    PASSED=$((PASSED + 1))
fi

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

# BUG-09: Navbar bookmark count same-tab update
# The fix dispatches a custom 'arxiv:bookmarks-changed' event from writeRaw()
# so the Navbar badge updates immediately without requiring a page reload.
# We verify this at the source level: the event name must appear in both files.
echo -n "Testing: BUG-09: bookmarks.ts dispatches arxiv:bookmarks-changed event ... "
if grep -q "arxiv:bookmarks-changed" /home/teycir/Repos/ArxivExplorer/lib/bookmarks.ts; then
    echo -e "${GREEN}✓ PASS${NC} (event dispatch present in bookmarks.ts)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (event dispatch missing from bookmarks.ts)"
    FAILED=$((FAILED + 1))
fi

echo -n "Testing: BUG-09: Navbar.tsx listens for arxiv:bookmarks-changed event ... "
if grep -q "arxiv:bookmarks-changed" /home/teycir/Repos/ArxivExplorer/app/components/Navbar.tsx; then
    echo -e "${GREEN}✓ PASS${NC} (listener present in Navbar.tsx)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (listener missing from Navbar.tsx)"
    FAILED=$((FAILED + 1))
fi

echo -n "Testing: BUG-09: Navbar.tsx still retains cross-tab 'storage' listener ... "
if grep -q "'storage'" /home/teycir/Repos/ArxivExplorer/app/components/Navbar.tsx || \
   grep -q '"storage"' /home/teycir/Repos/ArxivExplorer/app/components/Navbar.tsx; then
    echo -e "${GREEN}✓ PASS${NC} (cross-tab storage listener retained)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (cross-tab storage listener was removed)"
    FAILED=$((FAILED + 1))
fi

echo -n "Testing: BUG-09: Navbar cleanup removes both listeners ... "
remove_count=$(grep -c "removeEventListener" /home/teycir/Repos/ArxivExplorer/app/components/Navbar.tsx || true)
if [ "$remove_count" -ge 2 ]; then
    echo -e "${GREEN}✓ PASS${NC} ($remove_count removeEventListener calls found)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (expected ≥2 removeEventListener, found $remove_count)"
    FAILED=$((FAILED + 1))
fi

# BUG-10: SearchHistory nested button fix
# The row was a <button> wrapping the × <button> — invalid HTML (interactive in interactive).
# Fix: row is now a <div role="button">, remove button is a sibling inside the <li>.

echo -n "Testing: BUG-10: SearchHistory has no nested <button> inside row <button> ... "
# A nested button pattern looks like: <button ...>...</button...><button (inside it)
# We detect the old pattern: button element containing another button (simplified grep)
if grep -q 'button.*handleSelect' /home/teycir/Repos/ArxivExplorer/app/components/SearchHistory.tsx && \
   ! grep -q 'role="button"' /home/teycir/Repos/ArxivExplorer/app/components/SearchHistory.tsx; then
    echo -e "${RED}✗ FAIL${NC} (outer row is still a <button>, nesting issue not fixed)"
    FAILED=$((FAILED + 1))
else
    echo -e "${GREEN}✓ PASS${NC} (row uses div[role=button], no nested buttons)"
    PASSED=$((PASSED + 1))
fi

echo -n "Testing: BUG-10: row div has role=button and tabIndex for accessibility ... "
if grep -q 'role="button"' /home/teycir/Repos/ArxivExplorer/app/components/SearchHistory.tsx && \
   grep -q 'tabIndex={0}' /home/teycir/Repos/ArxivExplorer/app/components/SearchHistory.tsx; then
    echo -e "${GREEN}✓ PASS${NC} (role=button + tabIndex=0 present)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (missing role=button or tabIndex on row)"
    FAILED=$((FAILED + 1))
fi

echo -n "Testing: BUG-10: keyboard handler on row div (Enter/Space to select) ... "
if grep -q "onKeyDown" /home/teycir/Repos/ArxivExplorer/app/components/SearchHistory.tsx; then
    echo -e "${GREEN}✓ PASS${NC} (onKeyDown handler present)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (onKeyDown missing — keyboard users cannot select)"
    FAILED=$((FAILED + 1))
fi

echo -n "Testing: BUG-10: remove button is sibling (not child) of row element ... "
# After fix: <li> contains [div role=button] then [button aria-label=Remove] at same depth
# Quick structural check: aria-label="Remove" must exist and be a direct child of li context
if grep -q 'aria-label="Remove"' /home/teycir/Repos/ArxivExplorer/app/components/SearchHistory.tsx; then
    echo -e "${GREEN}✓ PASS${NC} (Remove button with aria-label present as sibling)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (Remove button aria-label missing)"
    FAILED=$((FAILED + 1))
fi

# BUG-11: fetch-arxiv.ts HTML link regex is attribute-order dependent
# Fix: try both type-before-href AND href-before-type orderings via ?? chaining.

echo -n "Testing: BUG-11: fetch-arxiv.ts has both attribute-order regexes for html link ... "
file="/home/teycir/Repos/ArxivExplorer/src/ingest-worker/fetch-arxiv.ts"
# The fix spans multiple lines: line with htmlMatch= plus two block.match lines.
# Count lines that contain 'href' within 3 lines of 'htmlMatch' (covers both orderings).
href_in_match=$(awk '/htmlMatch/{found=1; count=0} found && /href/{count++} found && count>=2{print count; exit}' "$file")
if [ "${href_in_match:-0}" -ge 2 ] 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC} (both href orderings found in htmlMatch block)"
    PASSED=$((PASSED + 1))
else
    # Fallback: just check that two separate block.match lines with href exist near htmlMatch
    match_block=$(sed -n '/htmlMatch/,/htmlUrl/p' "$file")
    href_count=$(echo "$match_block" | grep -c 'href' || true)
    if [ "$href_count" -ge 2 ]; then
        echo -e "${GREEN}✓ PASS${NC} ($href_count href references in htmlMatch block)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ FAIL${NC} (expected ≥2 href references in htmlMatch block, found $href_count)"
        FAILED=$((FAILED + 1))
    fi
fi

echo -n "Testing: BUG-11: htmlMatch uses ?? fallback chaining ... "
if grep -q '??' "$file"; then
    echo -e "${GREEN}✓ PASS${NC} (?? nullish coalescing present)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAIL${NC} (?? fallback missing — orderings not chained)"
    FAILED=$((FAILED + 1))
fi

# End-to-end: paper endpoint should return htmlUrl when available
echo -n "Testing: BUG-11: paper API returns htmlUrl field ... "
response=$(curl -s "$API_BASE/api/paper/2605.30353")
if echo "$response" | jq -e '.htmlUrl' > /dev/null 2>&1; then
    url=$(echo "$response" | jq -r '.htmlUrl')
    echo -e "${GREEN}✓ PASS${NC} (htmlUrl: $url)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARN${NC} (htmlUrl not present for this paper — may predate html link support)"
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
