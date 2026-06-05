#!/bin/bash

API_URL="https://arxiv-api.arxivexplorer.workers.dev/api/classify-claim"
CONCURRENT=10
TOTAL_REQUESTS=50

# Sample claims to test
CLAIMS=(
  "Transformers achieve better performance than RNNs on machine translation tasks"
  "GPT-4 has 1 trillion parameters"
  "Dropout regularization always improves model performance"
  "Adam optimizer converges faster than SGD in all cases"
  "ResNet architecture solves the vanishing gradient problem"
  "BERT uses bidirectional attention mechanism"
  "Neural networks require large datasets to perform well"
  "Batch normalization eliminates the need for dropout"
  "Attention is all you need for sequence modeling"
  "Deep learning models are interpretable by design"
)

echo "🧪 Stress Testing Claims Classification API"
echo "============================================"
echo "Target: $API_URL"
echo "Concurrent requests: $CONCURRENT"
echo "Total requests: $TOTAL_REQUESTS"
echo ""

success=0
errors=0
total_time=0

# Sample abstracts
ABSTRACT="We propose a new neural network architecture called Transformer that relies entirely on attention mechanisms, dispensing with recurrence and convolutions. Experiments on machine translation tasks show state-of-the-art results while being more parallelizable and requiring less time to train."

TLDR="Transformer architecture achieves state-of-the-art results on translation tasks using only attention mechanisms."

# Function to make a single request
make_request() {
  local claim="${CLAIMS[$((RANDOM % ${#CLAIMS[@]}))]}"
  
  response=$(curl -s -w "\n%{http_code}\n%{time_total}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"claim\":\"$claim\",\"abstract\":\"$ABSTRACT\",\"tldr\":\"$TLDR\"}" 2>&1)
  
  http_code=$(echo "$response" | tail -2 | head -1)
  time_total=$(echo "$response" | tail -1)
  
  if [ "$http_code" = "200" ]; then
    echo "✓ $http_code (${time_total}s)"
    return 0
  else
    echo "✗ $http_code (${time_total}s)"
    return 1
  fi
}

export -f make_request
export API_URL CLAIMS ABSTRACT TLDR

# Run concurrent requests
echo "Starting stress test..."
echo ""

start_time=$(date +%s)

# Use GNU parallel if available, otherwise fall back to loop
if command -v parallel &> /dev/null; then
  seq $TOTAL_REQUESTS | parallel -j $CONCURRENT make_request
  exit_code=$?
else
  for i in $(seq 1 $TOTAL_REQUESTS); do
    make_request &
    if [ $((i % CONCURRENT)) -eq 0 ]; then
      wait
    fi
  done
  wait
  exit_code=0
fi

end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo ""
echo "============================================"
echo "📊 Results"
echo "============================================"
echo "Total requests: $TOTAL_REQUESTS"
echo "Total time: ${elapsed}s"
echo "Requests/sec: $(echo "scale=2; $TOTAL_REQUESTS / $elapsed" | bc)"
echo ""

if [ $exit_code -eq 0 ]; then
  echo "✅ Stress test completed successfully"
else
  echo "⚠️  Some requests failed"
fi
