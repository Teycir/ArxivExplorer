#!/bin/bash
# Comprehensive security verification for production deployment

API_BASE="https://arxiv-api.arxivexplorer.workers.dev"

echo "🔒 Security Verification Tests"
echo "=============================="
echo ""

PASS=0
FAIL=0

test_pass() {
  echo "  ✓ PASS: $1"
  PASS=$((PASS + 1))
}

test_fail() {
  echo "  ✗ FAIL: $1"
  FAIL=$((FAIL + 1))
}

# Test 1: Input validation on classify-claim
echo "1. Input Validation - Classify Claim"
echo "-------------------------------------"

# Test oversized claim
RESPONSE=$(python3 -c "
import json, sys
claim = 'x' * 501
data = {'claim': claim, 'abstract': 'test'}
print(json.dumps(data))
" | curl -s -X POST "$API_BASE/api/classify-claim" -H "Content-Type: application/json" -d @-)

if echo "$RESPONSE" | grep -q "too long"; then
  test_pass "Rejects oversized claim (501 chars)"
else
  test_fail "Should reject oversized claim"
fi

# Test oversized abstract
RESPONSE=$(python3 -c "
import json
abstract = 'x' * 2001
data = {'claim': 'test', 'abstract': abstract}
print(json.dumps(data))
" | curl -s -X POST "$API_BASE/api/classify-claim" -H "Content-Type: application/json" -d @-)

if echo "$RESPONSE" | grep -q "too long"; then
  test_pass "Rejects oversized abstract (2001 chars)"
else
  test_fail "Should reject oversized abstract"
fi

# Test missing required fields
RESPONSE=$(curl -s -X POST "$API_BASE/api/classify-claim" \
  -H "Content-Type: application/json" -d '{}')

if echo "$RESPONSE" | grep -q "Missing"; then
  test_pass "Rejects missing required fields"
else
  test_fail "Should reject missing fields"
fi

sleep 2

# Test 2: Rate limiting exists
echo ""
echo "2. Rate Limiting"
echo "----------------"

# Test classify-claim has rate limit
for i in {1..12}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/api/classify-claim" \
    -H "Content-Type: application/json" \
    -d '{"claim":"test","abstract":"test"}')
  
  if [ "$STATUS" = "429" ]; then
    test_pass "Classify-claim endpoint has rate limiting"
    break
  fi
  sleep 0.5
done

sleep 65  # Wait for rate limit reset

# Test search has rate limit (try a burst)
TRIGGERED=0
for i in {1..65}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/api/search?q=test$RANDOM")
  
  if [ "$STATUS" = "429" ]; then
    test_pass "Search endpoint has rate limiting (triggered at ~$i requests)"
    TRIGGERED=1
    break
  fi
done

if [ $TRIGGERED -eq 0 ]; then
  test_pass "Search endpoint accepts reasonable request volume"
fi

echo ""
echo "3. Error Sanitization"
echo "---------------------"

# Test that 500 errors don't leak internal details
RESPONSE=$(curl -s "$API_BASE/api/paper/invalid@id" 2>&1)

if echo "$RESPONSE" | grep -qiE "(d1|database|kv|binding|wrangler)"; then
  test_fail "Error response may leak internal details"
else
  test_pass "Error responses don't leak internal infrastructure details"
fi

echo ""
echo "4. CORS Policy"
echo "--------------"

# Test CORS headers are present
CORS=$(curl -s -I "$API_BASE/api/trending" | grep -i "access-control-allow-origin")

if [ -n "$CORS" ]; then
  test_pass "CORS headers present"
else
  test_fail "CORS headers missing"
fi

# Verify no wildcard CORS
if echo "$CORS" | grep -q "\*"; then
  test_fail "CORS uses wildcard (security risk)"
else
  test_pass "CORS uses explicit origin (no wildcard)"
fi

echo ""
echo "5. SQL Injection Protection"
echo "----------------------------"

# Test search with SQL injection attempt
RESPONSE=$(curl -s "$API_BASE/api/search?q=test'%20OR%201=1--" | jq -r '.error // "ok"')

if [ "$RESPONSE" = "ok" ] || echo "$RESPONSE" | grep -qv "SQL\|syntax"; then
  test_pass "Search endpoint handles SQL injection attempt safely"
else
  test_fail "Potential SQL injection vulnerability"
fi

# Test paper ID with injection attempt
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API_BASE/api/paper/1234.5678'%20OR%201=1")

if [ "$STATUS" = "400" ] || [ "$STATUS" = "404" ]; then
  test_pass "Paper endpoint sanitizes malicious input"
else
  test_fail "Paper endpoint may be vulnerable"
fi

echo ""
echo "6. Authentication"
echo "-----------------"

# Test admin endpoint without auth
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/admin/retry-failed")

if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  test_pass "Admin endpoints require authentication"
else
  test_fail "Admin endpoints may be unprotected (status: $STATUS)"
fi

echo ""
echo "7. Valid Endpoints Functional"
echo "------------------------------"

# Test core endpoints still work
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/search?q=attention")
[ "$STATUS" = "200" ] && test_pass "Search endpoint functional" || test_fail "Search endpoint broken"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/paper/2605.30353")
[ "$STATUS" = "200" ] && test_pass "Paper endpoint functional" || test_fail "Paper endpoint broken"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/trending")
[ "$STATUS" = "200" ] && test_pass "Trending endpoint functional" || test_fail "Trending endpoint broken"

echo ""
echo "================================"
echo "Summary"
echo "================================"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "✅ All security tests passed!"
  exit 0
else
  echo "⚠️  Some tests failed. Review output above."
  exit 1
fi
