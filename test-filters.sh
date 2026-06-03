#!/bin/bash
# Test all search filters end-to-end

BASE_URL="${API_BASE:-https://arxiv-api.arxivexplorer.workers.dev}"

echo "Testing ArxivExplorer Search Filters"
echo "====================================="
echo ""

# Test 1: Basic search
echo "1. Basic search (no filters)"
curl -s "${BASE_URL}/api/search?q=transformer" | jq -r '.total, .papers[0].title' | head -2
echo ""

# Test 2: Category filter
echo "2. Category filter (cs.LG)"
curl -s "${BASE_URL}/api/search?q=neural&category=cs.LG" | jq -r '.total'
echo ""

# Test 3: Date filter
echo "3. Date filter (week)"
curl -s "${BASE_URL}/api/search?q=neural&date=week" | jq -r '.total'
echo ""

# Test 4: Author filter
echo "4. Author filter (Hinton)"
curl -s "${BASE_URL}/api/search?q=neural&author=Hinton" | jq -r '.total'
echo ""

# Test 5: Min citations filter
echo "5. Min citations filter (≥50)"
curl -s "${BASE_URL}/api/search?q=transformer&minCitations=50" | jq -r '.total'
echo ""

# Test 6: Paper type filter
echo "6. Paper type filter (survey)"
curl -s "${BASE_URL}/api/search?q=neural&paperType=survey" | jq -r '.total'
echo ""

# Test 7: Has code filter
echo "7. Has code filter"
curl -s "${BASE_URL}/api/search?q=transformer&hasCode=1" | jq -r '.total'
echo ""

# Test 8: Open access filter
echo "8. Open access filter"
curl -s "${BASE_URL}/api/search?q=neural&openAccess=1" | jq -r '.total'
echo ""

# Test 9: Combined filters
echo "9. Combined filters (category + date + hasCode)"
curl -s "${BASE_URL}/api/search?q=transformer&category=cs.LG&date=month&hasCode=1" | jq -r '.total, .papers[0].title' | head -2
echo ""

echo "✓ All filter tests complete"
