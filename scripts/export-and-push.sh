#!/bin/bash
# Export local DB and push to remote D1 in batches

set -e

LOCAL_DB=".wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite"
BATCH_SIZE=100
TEMP_DIR="./temp_sql_batches"

mkdir -p "$TEMP_DIR"

echo "📦 Exporting papers table in batches..."

# Count total papers
TOTAL=$(sqlite3 "$LOCAL_DB" "SELECT COUNT(*) FROM papers")
echo "Total papers: $TOTAL"

BATCHES=$(( ($TOTAL + $BATCH_SIZE - 1) / $BATCH_SIZE ))
echo "Will create $BATCHES batch files"

# Export papers in batches
for i in $(seq 0 $(($BATCHES - 1))); do
    OFFSET=$(($i * $BATCH_SIZE))
    echo "Batch $i: OFFSET $OFFSET LIMIT $BATCH_SIZE"
    
    sqlite3 "$LOCAL_DB" <<EOF > "$TEMP_DIR/papers_batch_$i.sql"
.mode insert papers
SELECT * FROM papers LIMIT $BATCH_SIZE OFFSET $OFFSET;
EOF
done

# Export summaries in batches
echo "📦 Exporting summaries table..."
for i in $(seq 0 $(($BATCHES - 1))); do
    OFFSET=$(($i * $BATCH_SIZE))
    
    sqlite3 "$LOCAL_DB" <<EOF > "$TEMP_DIR/summaries_batch_$i.sql"
.mode insert summaries
SELECT * FROM summaries LIMIT $BATCH_SIZE OFFSET $OFFSET;
EOF
done

# Export paper_categories
echo "📦 Exporting paper_categories..."
sqlite3 "$LOCAL_DB" <<EOF > "$TEMP_DIR/paper_categories.sql"
.mode insert paper_categories
SELECT * FROM paper_categories;
EOF

echo "✅ Export complete. Now pushing to remote..."

# Push papers
for i in $(seq 0 $(($BATCHES - 1))); do
    echo "Pushing papers batch $i..."
    wrangler d1 execute arxiv-explorer --remote --file="$TEMP_DIR/papers_batch_$i.sql"
    sleep 1
done

# Push summaries
for i in $(seq 0 $(($BATCHES - 1))); do
    echo "Pushing summaries batch $i..."
    wrangler d1 execute arxiv-explorer --remote --file="$TEMP_DIR/summaries_batch_$i.sql"
    sleep 1
done

# Push paper_categories
echo "Pushing paper_categories..."
wrangler d1 execute arxiv-explorer --remote --file="$TEMP_DIR/paper_categories.sql"

echo "✅ Push complete!"
echo "🧹 Cleaning up temp files..."
rm -rf "$TEMP_DIR"

echo "🎉 Done! Verify with:"
echo "wrangler d1 execute arxiv-explorer --remote --command='SELECT COUNT(*) FROM papers'"
