#!/usr/bin/env tsx
/**
 * ⛔ DEPRECATED — DO NOT USE
 *
 * This script generated embeddings via Ollama (nomic-embed-text) and pushed
 * them to Vectorize. The search worker uses @cf/baai/bge-base-en-v1.5 (CF AI).
 * These are DIFFERENT vector spaces — this breaks semantic search entirely.
 *
 * USE INSTEAD:
 *   ADMIN_SECRET=xxx npm run upload-embeddings
 *   → routes to scripts/reembed-with-cf-ai.ts (generates via CF AI, correct)
 */

console.error(`
⛔  DEPRECATED — scripts/generate-and-upload-embeddings.ts

This script generated Ollama/nomic-embed-text vectors and pushed them to
Vectorize, breaking semantic search (incompatible vector spaces with the
@cf/baai/bge-base-en-v1.5 model the worker uses at query time).

Run this instead:
  ADMIN_SECRET=xxx npm run upload-embeddings
  (routes to scripts/reembed-with-cf-ai.ts — uses CF AI, correct model)
`);
process.exit(1);
