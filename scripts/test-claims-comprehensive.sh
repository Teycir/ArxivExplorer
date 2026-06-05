#!/bin/bash

API_URL="https://arxiv-api.arxivexplorer.workers.dev"

# 20 diverse claims covering different scenarios
declare -a CLAIMS=(
  # Clear technical claims (should work well)
  "Transformers use self-attention mechanisms"
  "BERT is a bidirectional language model"
  "ResNet uses skip connections to address vanishing gradients"
  "Attention mechanisms have quadratic computational complexity"
  "Dropout is a regularization technique"
  
  # Comparative claims (harder to classify)
  "Transformers are faster than RNNs for parallel processing"
  "CNNs outperform transformers on image classification"
  "Adam optimizer converges faster than SGD"
  "LSTM networks handle long sequences better than standard RNNs"
  
  # Absolute claims (should contradict or need nuance)
  "Neural networks are always interpretable"
  "Dropout always prevents overfitting"
  "Batch normalization eliminates all training instabilities"
  "Larger models always perform better"
  
  # Specific factual claims
  "GPT-3 has 175 billion parameters"
  "AlexNet won ImageNet 2012 competition"
  "Word2Vec uses skip-gram or CBOW architectures"
  
  # Recent concepts
  "Vision transformers can process images as sequences of patches"
  "Diffusion models generate images through iterative denoising"
  "Reinforcement learning from human feedback improves language models"
  "Mixture of experts reduces computational cost"
)

echo "🧪 Comprehensive Claims Integration Test"
echo "========================================="
echo "Testing ${#CLAIMS[@]} diverse claims"
echo ""

total=0
classified=0
support=0
contradict=0
neutral=0
errors=0
start_time=$(date +%s)

for claim in "${CLAIMS[@]}"; do
  ((total++))
  echo "[$total/${#CLAIMS[@]}] Testing: \"$claim\""
  
  # Search
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
  
  # Get first paper
  abstract=$(echo "$search_result" | jq -r '.papers[0].abstract')
  tldr=$(echo "$search_result" | jq -r '.papers[0].summary.tldr // ""')
  title=$(echo "$search_result" | jq -r '.papers[0].title')
  
  # Classify
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
  confidence=$(echo "$classify_result" | jq -r '.confidence // 0.5')
  reasoning=$(echo "$classify_result" | jq -r '.reasoning // "No reasoning"')
  
  ((classified++))
  
  case "$result" in
    support) ((support++)) ;;
    contradict) ((contradict++)) ;;
    neutral) ((neutral++)) ;;
  esac
  
  echo "     Paper: ${title:0:50}..."
  echo "     Result: $result (confidence: $confidence)"
  echo "     Reason: ${reasoning:0:70}..."
  echo ""
  
  sleep 0.3
done

end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo "========================================="
echo "📊 Final Results"
echo "========================================="
echo "Total claims tested: $total"
echo "Successfully classified: $classified"
echo "Errors: $errors"
echo "Time: ${elapsed}s"
echo ""
echo "Classification Distribution:"
echo "  ✅ Support: $support ($((support * 100 / classified))%)"
echo "  ❌ Contradict: $contradict ($((contradict * 100 / classified))%)"
echo "  ⚪ Neutral: $neutral ($((neutral * 100 / classified))%)"
echo ""

# Assess quality
if [ $neutral -gt $((classified * 70 / 100)) ]; then
  echo "⚠️  WARNING: >70% neutral - search relevance issue or database coverage gaps"
fi

if [ $support -gt 0 ] && [ $contradict -gt 0 ]; then
  echo "✅ Good: Both support and contradict classifications found"
fi

if [ $errors -gt $((total / 5)) ]; then
  echo "❌ HIGH ERROR RATE: $errors/$total failed"
else
  echo "✅ Error rate acceptable: $errors/$total"
fi

success_rate=$((classified * 100 / total))
echo ""
echo "Success rate: ${success_rate}%"
