# Related Papers Fix - Bidirectional Algorithm

## Problem

The related papers feature was breaking when new papers were added to the database. Older papers would never show newer papers as related, only showing relationships that existed at ingestion time.

### Root Cause

The original algorithm only computed **one-directional** relationships:

```
When paper A is ingested:
✅ Store: A → [B, C, D] (papers similar to A)
❌ Missing: B → [..., A], C → [..., A], D → [..., A]
```

This meant:
- New papers could find older similar papers
- Older papers never updated to include newer similar papers
- The "Related papers will appear here once more papers are indexed" message persisted even after relevant papers were added

## Solution

Implemented a **bidirectional** algorithm that updates relationships in both directions:

### 1. Forward Links (as before)
When paper A is ingested, find and store its top-8 similar papers:
```typescript
A → [B, C, D, E, F, G, H, I]
```

### 2. Reverse Links (NEW)
For each paper in the forward list (B, C, D, etc.), recompute their top-8 to potentially include paper A:
```typescript
B → recompute top-8 (may now include A)
C → recompute top-8 (may now include A)
D → recompute top-8 (may now include A)
...
```

### Implementation

**File: `src/ingest-worker/compute-related.ts`**

Added `updateReverseLinksBatch()` function that:
1. Takes the list of papers found similar to the new paper
2. For each similar paper, recomputes its top-8 related papers
3. Batch updates all relationships to D1

```typescript
// After storing forward links
await updateReverseLinksBatch(paperId, finalResults.map(r => r.id), corpus, env);
```

### Performance Characteristics

- **Time complexity**: For each new paper, recomputes up to 8 additional papers (8 × TOP_K operations)
- **Database writes**: Up to 8 + (8 × 8) = 72 rows per paper
- **Batch optimization**: All updates batched (100 statements per D1 batch)

## Admin Tools

Added three admin endpoints for maintenance:

### 1. GET /admin/papers/all
Fetches all summarized papers for offline processing.

### 2. POST /admin/related/clear
Clears the entire `related_papers` table.

### 3. POST /admin/related/bulk-insert
Bulk inserts related_papers rows.

**Body:**
```json
{
  "rows": [
    { "paperId": "...", "relatedId": "...", "score": 0.85, "rank": 1 }
  ]
}
```

## Backfill Script

**File: `scripts/rebuild-related-bidirectional.ts`**

Rebuilds the entire `related_papers` table with bidirectional relationships.

### Usage

```bash
ADMIN_SECRET=your_secret npx tsx scripts/rebuild-related-bidirectional.ts
```

### Process

1. Fetches all papers from D1
2. Clears existing `related_papers` table
3. Builds TF-IDF corpus
4. Computes bidirectional relationships for all papers
5. Bulk inserts results (batched)

### Expected Output

```
🚀 Rebuilding related_papers with bidirectional algorithm

📥 Fetching all summarized papers from remote D1...
✅ Fetched 970 papers

🗑️  Clearing existing related_papers table...
✅ Cleared related_papers table

📊 Building TF-IDF corpus...
✅ Corpus built with 970 papers

🔄 Computing bidirectional related papers...
  Processed 50/970 papers...
  Processed 100/970 papers...
  ...
✅ Computed 7760 total relationships

💾 Writing to D1...
  Inserted batch 1/16
  ...
✅ Done! Related papers rebuilt successfully.
   Total relationships: 7760
   Average per paper: 8.0
```

## Deployment Steps

### 1. Deploy the fix

```bash
npm run deploy:api
npm run deploy:ingest
```

### 2. Rebuild existing relationships (one-time)

```bash
ADMIN_SECRET=your_secret npx tsx scripts/rebuild-related-bidirectional.ts
```

### 3. Verify

Visit any paper page and check that:
- Related papers appear in the sidebar
- Newer papers show up in older papers' related lists

## Future Maintenance

- **Automatic**: New papers automatically create bidirectional relationships during ingestion
- **Manual rebuild**: Only needed if the algorithm changes or data corruption occurs
- **Cost**: ~72 database writes per paper (negligible on Cloudflare D1)

## Technical Details

### Database Schema

```sql
CREATE TABLE related_papers (
  paper_id         TEXT    NOT NULL REFERENCES papers(id),
  related_paper_id TEXT    NOT NULL REFERENCES papers(id),
  similarity_score REAL    NOT NULL,
  rank             INTEGER NOT NULL,  -- 1–8
  computed_at      TEXT    NOT NULL,
  PRIMARY KEY (paper_id, related_paper_id)
);
```

### TF-IDF Algorithm

- **Corpus size**: 600 most recent papers
- **Weighting**: Title weighted 2× (for stronger topical signal)
- **Top-K**: 8 related papers per paper
- **Optional upgrade**: Vectorize scores replace TF-IDF when available

### Edge Cases Handled

1. **New paper not yet in corpus**: Fetches separately and adds to corpus
2. **Empty corpus**: Skips computation gracefully
3. **Insufficient neighbours**: Falls back to TF-IDF only
4. **Vectorize unavailable**: Uses TF-IDF as primary algorithm

## Testing

After deployment, verify with:

1. **Check an old paper** (e.g., from 2024): Should show recent related papers
2. **Check a new paper**: Should appear in related lists of older papers
3. **Check database counts**:
   ```sql
   -- Should average ~8 relationships per paper
   SELECT 
     COUNT(*) as total_relationships,
     COUNT(DISTINCT paper_id) as papers_with_related,
     CAST(COUNT(*) AS REAL) / COUNT(DISTINCT paper_id) as avg_per_paper
   FROM related_papers;
   ```

## Rollback Plan

If issues arise:

1. Revert the commit:
   ```bash
   git revert 24ae1c3
   ```

2. Redeploy:
   ```bash
   npm run deploy:api
   npm run deploy:ingest
   ```

3. Rebuild using old algorithm:
   ```bash
   npx tsx scripts/backfill-related.ts
   ```
