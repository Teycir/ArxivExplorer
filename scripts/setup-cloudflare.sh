#!/bin/bash
set -e

echo "🚀 Setting up Cloudflare resources for arXiv Explorer..."

# Create KV namespace
echo "📦 Creating KV namespace..."
KV_OUTPUT=$(wrangler kv namespace create CACHE)
KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "\K[^"]+')
echo "✅ KV namespace created: $KV_ID"

# Create D1 database
echo "🗄️  Creating D1 database..."
D1_OUTPUT=$(wrangler d1 create arxiv-explorer)
D1_ID=$(echo "$D1_OUTPUT" | grep -oP 'database_id = "\K[^"]+')
echo "✅ D1 database created: $D1_ID"

# Create Vectorize index
echo "🔍 Creating Vectorize index..."
wrangler vectorize create arxiv-papers --dimensions=768 --metric=cosine
echo "✅ Vectorize index created: arxiv-papers"

# Update wrangler.api.toml
echo "📝 Updating wrangler.api.toml..."
sed -i "s/YOUR_KV_NAMESPACE_ID/$KV_ID/" wrangler.api.toml
sed -i "s/YOUR_D1_DATABASE_ID/$D1_ID/" wrangler.api.toml

# Update wrangler.ingest.toml
echo "📝 Updating wrangler.ingest.toml..."
sed -i "s/YOUR_KV_NAMESPACE_ID/$KV_ID/" wrangler.ingest.toml
sed -i "s/YOUR_D1_DATABASE_ID/$D1_ID/" wrangler.ingest.toml

echo ""
echo "✨ Setup complete!"
echo ""
echo "Resource IDs:"
echo "  KV Namespace: $KV_ID"
echo "  D1 Database:  $D1_ID"
echo "  Vectorize:    arxiv-papers"
echo ""
echo "Next steps:"
echo "  1. Run database migrations: wrangler d1 execute arxiv-explorer --file=migrations/schema.sql"
echo "  2. Deploy api-worker: wrangler deploy --config wrangler.api.toml"
echo "  3. Deploy ingest-worker: wrangler deploy --config wrangler.ingest.toml"
