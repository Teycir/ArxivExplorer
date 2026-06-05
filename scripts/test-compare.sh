#!/bin/bash
# Test script for compare functionality edge cases

BASE_URL="https://arxivexplorer.arxivexplorer.workers.dev"
API_URL="https://arxiv-api.arxivexplorer.workers.dev"

echo "🧪 Testing Compare Functionality Edge Cases"
echo "============================================="
echo

# Test Case 1: Papers that don't exist in DB
echo "📋 Test 1: Non-existent papers"
echo "Testing IDs: 9999.99999, 8888.88888"
curl -s "$BASE_URL/compare?ids=9999.99999,8888.88888" | grep -q "404" && echo "✅ PASS: Returns 404 for non-existent papers" || echo "❌ FAIL: Should return 404"
echo

# Test Case 2: Mix of valid and invalid papers
echo "📋 Test 2: Mix of valid and invalid papers"
echo "Testing IDs: 2606.06461 (valid), 9999.99999 (invalid)"
RESULT=$(curl -s "$BASE_URL/compare?ids=2606.06461,9999.99999" | grep -o "Comparing [0-9] paper")
if echo "$RESULT" | grep -q "Comparing 1 paper"; then
    echo "✅ PASS: Shows only 1 valid paper (silently drops invalid)"
else
    echo "❌ FAIL: Expected 'Comparing 1 paper', got: $RESULT"
fi
echo

# Test Case 3: Two valid papers that exist
echo "📋 Test 3: Two valid papers in DB"
echo "Testing IDs: 2606.06461, 2606.06423"
RESULT=$(curl -s "$BASE_URL/compare?ids=2606.06461,2606.06423" | grep -o "Comparing [0-9] paper")
if echo "$RESULT" | grep -q "Comparing 2 papers"; then
    echo "✅ PASS: Shows 2 papers correctly"
else
    echo "❌ FAIL: Expected 'Comparing 2 papers', got: $RESULT"
fi
echo

# Test Case 4: Papers from different categories (not close)
echo "📋 Test 4: Papers from different categories"
# Get two papers from different categories
PAPER_CS_LG=$(curl -s "$API_URL/api/search?q=machine+learning&category=cs.LG&limit=1" | jq -r '.papers[0].id' 2>/dev/null)
PAPER_CS_CR=$(curl -s "$API_URL/api/search?q=cryptography&category=cs.CR&limit=1" | jq -r '.papers[0].id' 2>/dev/null)

if [ -n "$PAPER_CS_LG" ] && [ -n "$PAPER_CS_CR" ] && [ "$PAPER_CS_LG" != "null" ] && [ "$PAPER_CS_CR" != "null" ]; then
    echo "Testing IDs: $PAPER_CS_LG (cs.LG), $PAPER_CS_CR (cs.CR)"
    RESULT=$(curl -s "$BASE_URL/compare?ids=$PAPER_CS_LG,$PAPER_CS_CR" | grep -o "Comparing [0-9] paper")
    if echo "$RESULT" | grep -q "Comparing 2 papers"; then
        echo "✅ PASS: Can compare papers from different categories"
    else
        echo "⚠️  WARNING: Could not compare papers from different categories"
    fi
else
    echo "⚠️  SKIP: Could not find papers from both categories"
fi
echo

# Test Case 5: Papers from same category (close topics)
echo "📋 Test 5: Papers from same category (semantically close)"
echo "Testing IDs: 2606.06461, 2606.06423 (both cs.RO)"
# These are the two papers we know exist and are in the same domain (robotics)
RESULT=$(curl -s "$BASE_URL/compare?ids=2606.06461,2606.06423" | grep -o "cs.RO")
COUNT=$(echo "$RESULT" | wc -l)
if [ "$COUNT" -ge 2 ]; then
    echo "✅ PASS: Both papers are from cs.RO (robotics)"
else
    echo "⚠️  WARNING: Papers might not be from the same category"
fi
echo

# Test Case 6: Empty IDs parameter
echo "📋 Test 6: Empty IDs parameter"
RESULT=$(curl -s "$BASE_URL/compare" | grep -o "Enter arXiv paper IDs")
if [ -n "$RESULT" ]; then
    echo "✅ PASS: Shows empty state with form"
else
    echo "❌ FAIL: Should show empty state"
fi
echo

# Test Case 7: More than 6 papers (should limit to 6)
echo "📋 Test 7: More than 6 papers (should cap at 6)"
RESULT=$(curl -s "$BASE_URL/compare?ids=2606.06461,2606.06423,2606.06461,2606.06423,2606.06461,2606.06423,2606.06461" | grep -o "Comparing [0-9] paper")
echo "Result: $RESULT"
echo "ℹ️  Note: Should cap at 6 papers maximum (deduplication may reduce count)"
echo

# Test Case 8: Duplicate paper IDs
echo "📋 Test 8: Duplicate paper IDs (should deduplicate)"
RESULT=$(curl -s "$BASE_URL/compare?ids=2606.06461,2606.06461,2606.06461" | grep -o "Comparing [0-9] paper")
if echo "$RESULT" | grep -q "Comparing 1 paper"; then
    echo "✅ PASS: Deduplicates to 1 paper"
else
    echo "⚠️  WARNING: Expected deduplication, got: $RESULT"
fi
echo

# Test Case 9: Special characters and injection attempts
echo "📋 Test 9: Input sanitization"
curl -s "$BASE_URL/compare?ids=%3Cscript%3Ealert(1)%3C/script%3E" | grep -q "404" && echo "✅ PASS: Sanitizes malicious input" || echo "⚠️  Check sanitization"
echo

echo "============================================="
echo "✅ Compare functionality testing complete"
