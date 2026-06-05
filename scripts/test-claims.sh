#!/bin/bash

API_BASE="https://arxiv-api.arxivexplorer.workers.dev"

echo "=== Claims Classification Test ==="
echo

# Find a paper first
echo "Finding a transformer paper..."
PAPER_ID=$(curl -s "$API_BASE/api/search?q=transformer&limit=1" | jq -r '.papers[0].id')

if [ -z "$PAPER_ID" ] || [ "$PAPER_ID" = "null" ]; then
  echo "❌ No papers found"
  exit 1
fi

echo "✓ Using paper: $PAPER_ID"

# Fetch paper data
PAPER_DATA=$(curl -s "$API_BASE/api/paper/$PAPER_ID")
ABSTRACT=$(echo "$PAPER_DATA" | jq -r '.abstract')
TLDR=$(echo "$PAPER_DATA" | jq -r '.summary.tldr // ""')

if [ -z "$ABSTRACT" ] || [ "$ABSTRACT" = "null" ]; then
  echo "❌ Failed to fetch paper data"
  exit 1
fi

echo "✓ Paper data fetched"
echo

# Test 1: Valid 3-word claim
echo "Test 1: 'Transformers work well'"
curl -s -X POST "$API_BASE/api/classify-claim" \
  -H 'Content-Type: application/json' \
  -d "{\"claim\":\"Transformers work well\",\"abstract\":$(echo "$ABSTRACT" | jq -Rs .),\"tldr\":$(echo "$TLDR" | jq -Rs .)}" | jq '.'
echo

# Test 2: Valid 4-word claim
echo "Test 2: 'Attention improves model accuracy'"
curl -s -X POST "$API_BASE/api/classify-claim" \
  -H 'Content-Type: application/json' \
  -d "{\"claim\":\"Attention improves model accuracy\",\"abstract\":$(echo "$ABSTRACT" | jq -Rs .),\"tldr\":$(echo "$TLDR" | jq -Rs .)}" | jq '.'
echo

# Test 3: Contradicting 3-word claim
echo "Test 3: 'Transformers never work'"
curl -s -X POST "$API_BASE/api/classify-claim" \
  -H 'Content-Type: application/json' \
  -d "{\"claim\":\"Transformers never work\",\"abstract\":$(echo "$ABSTRACT" | jq -Rs .),\"tldr\":$(echo "$TLDR" | jq -Rs .)}" | jq '.'
echo

# Test 4: Neutral 3-word claim
echo "Test 4: 'Quantum computing exists'"
curl -s -X POST "$API_BASE/api/classify-claim" \
  -H 'Content-Type: application/json' \
  -d "{\"claim\":\"Quantum computing exists\",\"abstract\":$(echo "$ABSTRACT" | jq -Rs .),\"tldr\":$(echo "$TLDR" | jq -Rs .)}" | jq '.'
echo

echo "✓ Tests complete"
