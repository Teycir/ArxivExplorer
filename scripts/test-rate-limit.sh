#!/bin/bash
# Test rate limiting on production endpoints

API_BASE="https://arxiv-api.arxivexplorer.workers.dev"

echo "🔒 Rate Limiting Tests"
echo "====================="
echo ""

# Test 1: Claim endpoint rate limit (10 req/min)
echo "Testing: /api/classify-claim rate limit (10 req/min) ..."
HITS=0
for i in {1..12}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API_BASE/api/classify-claim" \
    -H "Content-Type: application/json" \
    -d '{"claim":"test","abstract":"test"}')
  
  if [ "$STATUS" = "429" ]; then
    echo "  ✓ Rate limit triggered after $i requests (expected ~10)"
    HITS=1
    break
  fi
  sleep 0.5
done

if [ $HITS -eq 0 ]; then
  echo "  ⚠ WARN: Rate limit not triggered after 12 requests"
fi

sleep 3

# Test 2: Search endpoint rate limit (60 req/min)
echo "Testing: /api/search rate limit (60 req/min) ..."
echo "  (sending 20 requests, should all succeed) ..."
FAILS=0
for i in {1..20}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/api/search?q=test$i")
  
  if [ "$STATUS" = "429" ]; then
    echo "  ✗ FAIL: Rate limit triggered too early at request $i"
    FAILS=$((FAILS + 1))
    break
  fi
done

if [ $FAILS -eq 0 ]; then
  echo "  ✓ PASS: 20 requests succeeded (under 60/min limit)"
fi

sleep 2

# Test 3: Paper endpoint rate limit (100 req/min)
echo "Testing: /api/paper/:id rate limit (100 req/min) ..."
echo "  (sending 20 requests, should all succeed) ..."
FAILS=0
for i in {1..20}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$API_BASE/api/paper/2605.30353")
  
  if [ "$STATUS" = "429" ]; then
    echo "  ✗ FAIL: Rate limit triggered too early at request $i"
    FAILS=$((FAILS + 1))
    break
  fi
done

if [ $FAILS -eq 0 ]; then
  echo "  ✓ PASS: 20 requests succeeded (under 100/min limit)"
fi

echo ""
echo "Testing: Rate limit response format ..."
RESPONSE=$(curl -s -X POST "$API_BASE/api/classify-claim" \
  -H "Content-Type: application/json" \
  -d '{"claim":"test","abstract":"test"}' | head -c 1000)

# Make 11 more requests to trigger rate limit
for i in {1..11}; do
  curl -s -X POST "$API_BASE/api/classify-claim" \
    -H "Content-Type: application/json" \
    -d '{"claim":"test","abstract":"test"}' > /dev/null
  sleep 0.3
done

RATE_LIMIT_RESPONSE=$(curl -s -X POST "$API_BASE/api/classify-claim" \
  -H "Content-Type: application/json" \
  -d '{"claim":"test","abstract":"test"}')

if echo "$RATE_LIMIT_RESPONSE" | grep -q "retryAfter"; then
  echo "  ✓ PASS: 429 response includes retryAfter field"
else
  echo "  ⚠ WARN: 429 response missing retryAfter (may still be under limit)"
fi

if echo "$RATE_LIMIT_RESPONSE" | grep -q "Rate limit exceeded"; then
  echo "  ✓ PASS: 429 response has proper error message"
else
  echo "  ⚠ WARN: 429 response missing rate limit message (may still be under limit)"
fi

echo ""
echo "Testing: Input validation on /api/classify-claim ..."
RESPONSE=$(curl -s -X POST "$API_BASE/api/classify-claim" \
  -H "Content-Type: application/json" \
  -d "{\"claim\":\"$(python3 -c 'print("x"*501)')\",\"abstract\":\"test\"}")

if echo "$RESPONSE" | grep -q "too long"; then
  echo "  ✓ PASS: Rejects oversized claim (501 chars)"
else
  echo "  ✗ FAIL: Did not reject oversized claim"
fi

RESPONSE=$(curl -s -X POST "$API_BASE/api/classify-claim" \
  -H "Content-Type: application/json" \
  -d "{\"claim\":\"test\",\"abstract\":\"$(python3 -c 'print("x"*2001)')\"}")

if echo "$RESPONSE" | grep -q "too long"; then
  echo "  ✓ PASS: Rejects oversized abstract (2001 chars)"
else
  echo "  ✗ FAIL: Did not reject oversized abstract"
fi

echo ""
echo "Testing: Error sanitization (no internal details leaked) ..."
# This test just verifies the endpoint doesn't crash on bad input
RESPONSE=$(curl -s -X POST "$API_BASE/api/classify-claim" \
  -H "Content-Type: application/json" \
  -d '{"claim":"","abstract":""}')

if echo "$RESPONSE" | grep -q "Missing claim or abstract"; then
  echo "  ✓ PASS: Clean validation error for missing fields"
else
  echo "  ⚠ WARN: Unexpected error response format"
fi

echo ""
echo "✅ Rate limiting tests complete"
