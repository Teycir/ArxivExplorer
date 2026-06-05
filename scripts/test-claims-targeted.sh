#!/bin/bash

API_URL="https://arxiv-api.arxivexplorer.workers.dev"

# Test with specific search terms that should find relevant papers
declare -a TEST_CASES=(
  "Transformer architecture uses attention|Transformers use attention mechanisms|support"
  "BERT is bidirectional|BERT uses unidirectional attention|contradict"
  "ResNet residual connections|ResNet solves vanishing gradients|support"
  "GPT language model|GPT-3 has 175 billion parameters|support"
  "Self-attention complexity|Self-attention has quadratic complexity|support"
  "Dropout regularization overfitting|Dropout always prevents overfitting|contradict"
  "Neural network interpretability|Neural networks are interpretable|neutral"
  "Batch normalization training|Batch normalization eliminates covariate shift|neutral"
  "CNN image classification transformer|CNNs outperform transformers on images|neutral"
  "RNN sequence modeling|Transformers are faster than RNNs|support"
)

echo "🧪 Claims Classification Integration Test (Targeted)"
echo "===================================================="
echo ""

total=0
correct=0
support_count=0
contradict_count=0
neutral_count=0

for test_case in "${TEST_CASES[@]}"; do
  IFS='|' read -r search_query claim expected <<< "$test_case"
  
  ((total++))
  echo "[$total/${#TEST_CASES[@]}] Claim: \"$claim\""
  echo "     Query: \"$search_query\""
  echo "     Expected: $expected"
  
  # Search for relevant papers
  search_result=$(curl -s "$API_URL/api/search?q=$(echo "$search_query" | jq -sRr @uri)&limit=3")
  
  if [ $? -ne 0 ] || [ -z "$search_result" ]; then
    echo "     ❌ Search failed"
    echo ""
    continue
  fi
  
  paper_count=$(echo "$search_result" | jq '.papers | length')
  if [ "$paper_count" -eq 0 ]; then
    echo "     ⚠️  No papers found"
    echo ""
    continue
  fi
  
  # Get first paper
  abstract=$(echo "$search_result" | jq -r '.papers[0].abstract')
  tldr=$(echo "$search_result" | jq -r '.papers[0].summary.tldr // ""')
  paper_title=$(echo "$search_result" | jq -r '.papers[0].title')
  
  # Classify
  classify_result=$(curl -s -X POST "$API_URL/api/classify-claim" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg claim "$claim" --arg abstract "$abstract" --arg tldr "$tldr" \
      '{claim: $claim, abstract: $abstract, tldr: $tldr}')")
  
  if [ $? -ne 0 ] || [ -z "$classify_result" ]; then
    echo "     ❌ Classification failed"
    echo ""
    continue
  fi
  
  result=$(echo "$classify_result" | jq -r '.result')
  reasoning=$(echo "$classify_result" | jq -r '.reasoning // "No reasoning"')
  
  # Count by result type
  case "$result" in
    support) ((support_count++)) ;;
    contradict) ((contradict_count++)) ;;
    neutral) ((neutral_count++)) ;;
  esac
  
  echo "     Paper: ${paper_title:0:55}..."
  echo "     Result: $result"
  echo "     Reason: ${reasoning:0:75}..."
  
  if [ "$result" == "$expected" ]; then
    echo "     ✅ PASS"
    ((correct++))
  else
    echo "     ⚠️  MISMATCH (expected: $expected)"
  fi
  
  echo ""
  sleep 0.5
done

echo "===================================================="
echo "📊 Final Results"
echo "===================================================="
echo "Tests run: $total"
echo "Correct: $correct"
echo "Mismatches: $((total - correct))"
echo ""
echo "Classification Distribution:"
echo "  Support: $support_count"
echo "  Contradict: $contradict_count"
echo "  Neutral: $neutral_count"
echo ""

if [ $total -gt 0 ]; then
  accuracy=$(echo "scale=1; ($correct * 100) / $total" | bc)
  echo "Accuracy: ${accuracy}%"
  echo ""
  
  if (( $(echo "$accuracy >= 80.0" | bc -l) )); then
    echo "✅ Excellent performance"
  elif (( $(echo "$accuracy >= 60.0" | bc -l) )); then
    echo "✅ Good performance"
  elif (( $(echo "$accuracy >= 40.0" | bc -l) )); then
    echo "⚠️  Acceptable performance"
  else
    echo "❌ Needs improvement"
  fi
fi
