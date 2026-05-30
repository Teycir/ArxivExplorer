# Error Handling & Logging Guide

Quick reference for maintaining consistent error handling across the ArxivExplorer codebase.

---

## Core Principles

1. **Never swallow errors** — Always log or re-throw
2. **Include context** — Log component, operation, and relevant IDs
3. **Degrade gracefully** — Cache failures shouldn't block requests
4. **Use appropriate status codes** — 400 for validation, 404 for not found, 500 for server errors
5. **Batch resilience** — Use `Promise.allSettled` so one failure doesn't abort the batch

---

## Patterns by Scenario

### 1. KV Cache Read (Non-Critical)

**Pattern:** Log error, continue to fallback

```typescript
try {
  const cached = await kvGet<unknown>(env.CACHE, cacheKey);
  if (cached !== null) {
    return jsonResponse(cached, cors);
  }
} catch (err) {
  console.error('[component] KV cache read error:', err);
  // Continue to D1 fallback
}
```

**When to use:** Cache reads where the data can be fetched from another source

---

### 2. Database Query (Critical)

**Pattern:** Log error, return 500 response

```typescript
let papers;
try {
  papers = await getTrendingPapers(env.DB, 10);
} catch (err) {
  console.error('[trending] D1 query error:', err);
  return errorResponse(`Database error: ${String(err)}`, cors, 500);
}
```

**When to use:** Database operations where failure means we can't fulfill the request

---

### 3. Validation Errors

**Pattern:** Return 400 with descriptive message

```typescript
if (!arxivId || !/^[\w./-]+$/.test(arxivId)) {
  return errorResponse('Invalid arXiv ID format', cors, 400);
}
```

**When to use:** User input validation

---

### 4. Not Found

**Pattern:** Return 404 with descriptive message

```typescript
if (!paper) {
  return errorResponse(`Paper not found: ${arxivId}`, cors, 404);
}
```

**When to use:** Resource doesn't exist

---

### 5. Parallel Operations with Fallback

**Pattern:** Use `Promise.allSettled`, log failures, continue with successes

```typescript
const [ftsResult, semanticResult] = await Promise.allSettled([
  runFtsSearch(env.DB, normalised),
  runSemanticSearch(env, ctx, normalised, queryHash),
]);

const ftsRows = ftsResult.status === 'fulfilled' ? ftsResult.value : [];
if (ftsResult.status === 'rejected') {
  console.error('[search] FTS error:', ftsResult.reason);
}

const semanticMatches = semanticResult.status === 'fulfilled' ? semanticResult.value : [];
if (semanticResult.status === 'rejected') {
  console.error('[search] Semantic search error:', semanticResult.reason);
}
```

**When to use:** Multiple data sources where partial results are acceptable

---

### 6. Batch Processing

**Pattern:** Use `Promise.allSettled`, track successes and failures

```typescript
const settledResults = await runConcurrent(
  newEntries,
  async (entry) => processSinglePaper(entry, env),
  concurrency
);

for (const r of settledResults) {
  if (r.status === 'fulfilled') {
    result.summarized++;
  } else {
    result.failed++;
    console.error('[pipeline] Paper processing failed:', r.reason);
  }
}
```

**When to use:** Processing multiple items where one failure shouldn't abort the batch

---

### 7. Fatal Pipeline Errors

**Pattern:** Log and re-throw

```typescript
try {
  await batchInsertPapers(env.DB, newEntries);
} catch (err) {
  console.error('[pipeline] Batch paper insert failed:', err);
  throw err; // Fatal — cannot continue without base rows
}
```

**When to use:** Critical operations where failure means the entire pipeline must abort

---

### 8. Non-Fatal Pipeline Errors

**Pattern:** Log as warning, continue

```typescript
try {
  await computeAndStoreRelated(id, embedding, env);
} catch (err) {
  console.warn(`[pipeline] compute-related failed for ${id} (non-fatal):`, err);
}
```

**When to use:** Optional operations that shouldn't block the main flow

---

### 9. Fire-and-Forget Operations

**Pattern:** Use `ctx.waitUntil()` to ensure completion

```typescript
export function kvPutAsync(
  ctx: ExecutionContext,
  kv: KVNamespace,
  key: string,
  value: unknown,
  expirationTtl?: number
): void {
  const serialized = JSON.stringify(value);
  const options = expirationTtl != null ? { expirationTtl } : undefined;
  ctx.waitUntil(kv.put(key, serialized, options));
}
```

**When to use:** Cache writes that shouldn't block the response

---

### 10. Client-Side API Calls

**Pattern:** Throw with full context

```typescript
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json() as { error?: string };
      detail = body.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`API ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''} — ${API_BASE}${path}`);
  }

  return res.json() as Promise<T>;
}
```

**When to use:** All API client functions

---

## Logging Conventions

### Component Prefixes

Always use a consistent prefix for your component:

```typescript
console.error('[search] KV cache read error:', err);
console.error('[paper] D1 query error for ${arxivId}:', err);
console.error('[pipeline] Batch paper insert failed:', err);
```

**Standard prefixes:**
- `[api-worker]` — Main API worker
- `[search]` — Search route
- `[paper]` — Paper route
- `[related]` — Related papers route
- `[trending]` — Trending route
- `[author]` — Author route
- `[topic]` — Topic route
- `[ingest-worker]` — Main ingest worker
- `[pipeline]` — Ingestion pipeline
- `[fetch-arxiv]` — arXiv API fetcher

### Log Levels

```typescript
// Normal operations, progress updates
console.info('[pipeline] Fetched ${entries.length} entries for ${category}');

// Non-fatal issues that should be monitored
console.warn('[pipeline] compute-related failed for ${id} (non-fatal):', err);

// Errors that need attention
console.error('[search] FTS error:', ftsResult.reason);
```

### Include Context

Always include relevant identifiers:

```typescript
// ✅ Good — includes arXiv ID
console.error(`[paper] D1 query error for ${arxivId}:`, err);

// ❌ Bad — no context
console.error('Database error:', err);
```

---

## Response Helpers

### Success Response

```typescript
import { jsonResponse, corsHeaders } from '../../shared/utils';

const cors = corsHeaders(env);
return jsonResponse({ papers, total: papers.length }, cors);
```

### Error Response

```typescript
import { errorResponse, corsHeaders } from '../../shared/utils';

const cors = corsHeaders(env);
return errorResponse('Invalid arXiv ID format', cors, 400);
```

---

## Testing Error Paths

### Manual Testing Checklist

- [ ] Invalid input (empty, too long, wrong format)
- [ ] Resource not found (paper ID, topic slug, author name)
- [ ] Database unavailable (simulate with invalid query)
- [ ] Cache unavailable (simulate with KV namespace not bound)
- [ ] Rate limiting (arXiv API 429)
- [ ] Malformed API responses (Workers AI, arXiv XML)
- [ ] Concurrent batch failures (some papers succeed, some fail)

### Example Test Cases

```typescript
// Test validation error
const res = await fetch('https://api/paper/invalid-id');
assert(res.status === 400);
assert((await res.json()).error.includes('Invalid'));

// Test not found
const res = await fetch('https://api/paper/9999.99999');
assert(res.status === 404);
assert((await res.json()).error.includes('not found'));

// Test database error (requires mocking)
const res = await fetch('https://api/trending');
// If DB is down, should return 500 with error detail
```

---

## Common Mistakes to Avoid

### ❌ Silent Error Swallowing

```typescript
// BAD — error is lost
try {
  await someOperation();
} catch {
  // Nothing here
}
```

```typescript
// GOOD — error is logged
try {
  await someOperation();
} catch (err) {
  console.error('[component] Operation failed:', err);
  throw err; // or handle appropriately
}
```

### ❌ Missing Context

```typescript
// BAD — no context
console.error('Error:', err);
```

```typescript
// GOOD — includes component and operation
console.error('[search] KV cache read error:', err);
```

### ❌ Blocking on Non-Critical Operations

```typescript
// BAD — cache write blocks response
await kv.put(key, value);
return jsonResponse(data, cors);
```

```typescript
// GOOD — fire-and-forget
kvPutAsync(ctx, kv, key, value);
return jsonResponse(data, cors);
```

### ❌ Aborting Batch on Single Failure

```typescript
// BAD — one failure aborts everything
for (const item of items) {
  await processItem(item); // throws on error
}
```

```typescript
// GOOD — continue processing other items
const results = await Promise.allSettled(
  items.map(item => processItem(item))
);
```

---

## Quick Reference: When to Use Each Pattern

| Scenario | Pattern | Status Code | Log Level |
|----------|---------|-------------|-----------|
| Cache miss | Continue to fallback | N/A | `error` |
| Database error | Return error response | 500 | `error` |
| Invalid input | Return error response | 400 | N/A |
| Resource not found | Return error response | 404 | N/A |
| Parallel operations | `Promise.allSettled` | N/A | `error` |
| Batch processing | `Promise.allSettled` | N/A | `error` |
| Fatal pipeline error | Log and re-throw | N/A | `error` |
| Non-fatal pipeline error | Log and continue | N/A | `warn` |
| Fire-and-forget | `ctx.waitUntil()` | N/A | N/A |
| Client API call | Throw with context | N/A | N/A |

---

## Summary

**Golden Rules:**
1. Always log errors with component prefix and context
2. Never swallow errors silently
3. Use appropriate HTTP status codes
4. Degrade gracefully for non-critical failures
5. Use `Promise.allSettled` for batch operations
6. Use `ctx.waitUntil()` for fire-and-forget operations

**When in doubt:**
- Log the error with full context
- Return an appropriate error response to the client
- Don't block the request for non-critical operations
