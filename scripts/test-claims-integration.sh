#!/bin/bash

API_URL="https://arxiv-api.arxivexplorer.workers.dev"

# Test claims with expected outcomes
declare -a CLAIMS=(
  "Attention mechanisms improve translation quality"
  "Transformers require more compute than RNNs"
  "BERT uses unidirectional attention"
  "Dropout always prevents overfitting"
  "ResNet solves vanishing gradients"
  "GPT-3 has 175 billion parameters"
  "Neural networks are interpretable"
  "Batch normalization eliminates covariate shift"
  "Self-attention has quadratic complexity"
  "CNNs outperform transformers on images"
)

declare -a EXPECTED=(
  "support"    # 1. Attention is All You Need supports this
  "support"    # 2. Known fact about transformers
  "contradict" # 3. BERT is bidirectional
  "contradict" # 4. Overly strong claim
  "support"    # 5. Core contribution of ResNet
  "support"    # 6. Known fact
  "contradict" # 7. Black box problem
  "neutral"    # 8. Debated/complex topic
  "support"    # 9. Well-established
  "neutral"    # 10. Depends on task/context
)

echo "🧪 Claims Classification Integration Test"
echo "========================================"
echo ""

total=0
correct=0
errors=0

for i in "${!CLAIMS[@]}"; do
  claim="${CLAIMS[$i]}"
  expected="${EXPECTED[$i]}"
  
  echo "[$((i+1))/10] Testing: \"$claim\""
  echo "     Expected: $expected"
  
  # Step 1: Search for papers
  search_result=$(curl -s "$API_URL/api/search?q=$(echo "$claim" | jq -sRr @uri)&limit=5")
  
  if [ $? -ne 0 ] || [ -z "$search_result" ]; then
    echo "     ❌ Search failed"
    ((errors++))
    echo ""
    continue
  fi
  
  paper_count=$(echo "$search_result" | jq '.papers | length')
  if [ "$paper_count" -eq 0 ]; then
    echo "     ⚠️  No papers found"
    echo ""
    continue
  fi
  
  # Get first paper for classification
  abstract=$(echo "$search_result" | jq -r '.papers[0].abstract')
  tldr=$(echo "$search_result" | jq -r '.papers[0].summary.tldr // ""')
  paper_title=$(echo "$search_result" | jq -r '.papers[0].title')
  
  # Step 2: Classify claim
  classify_result=$(curl -s -X POST "$API_URL/api/classify-claim" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg claim "$claim" --arg abstract "$abstract" --arg tldr "$tldr" \
      '{claim: $claim, abstract: $abstract, tldr: $tldr}')")
  
  if [ $? -ne 0 ] || [ -z "$classify_result" ]; then
    echo "     ❌ Classification failed"
    ((errors++))
    echo ""
    continue
  fi
  
  result=$(echo "$classify_result" | jq -r '.result')
  reasoning=$(echo "$classify_result" | jq -r '.reasoning // "No reasoning provided"')
  
  echo "     Paper: ${paper_title:0:60}..."
  echo "     Result: $result"
  echo "     Reasoning: ${reasoning:0:80}..."
  
  ((total++))
  
  if [ "$result" == "$expected" ]; then
    echo "     ✅ PASS"
    ((correct++))
  else
    echo "     ⚠️  MISMATCH (got: $result, expected: $expected)"
  fi
  
  echo ""
  sleep 1  # Rate limiting
done

echo "========================================"
echo "📊 Results Summary"
echo "========================================"
echo "Total tests: $total"
echo "Correct: $correct"
echo "Mismatches: $((total - correct))"
echo "Errors: $errors"
echo ""

if [ $total -gt 0 ]; then
  accuracy=$(echo "scale=1; ($correct * 100) / $total" | bc)
  echo "Accuracy: ${accuracy}%"
  echo ""
  
  if [ "$accuracy" == "100.0" ]; then
    echo "✅ Perfect score!"
  elif (( $(echo "$accuracy >= 70.0" | bc -l) )); then
    echo "✅ Good performance"
  elif (( $(echo "$accuracy >= 50.0" | bc -l) )); then
    echo "⚠️  Acceptable performance"
  else
    echo "❌ Poor performance"
  fi
fi
