#!/usr/bin/env tsx
/**
 * ⛔ DEPRECATED — DO NOT USE
 *
 * This script uploaded raw Ollama (nomic-embed-text) vectors to Vectorize.
 * The search worker queries Vectorize using @cf/baai/bge-base-en-v1.5 (CF AI).
 * These are DIFFERENT vector spaces — uploading nomic vectors breaks semantic
 * search and the claim tracker (everything returns neutral).
 *
 * USE INSTEAD:
 *   ADMIN_SECRET=xxx npm run upload-embeddings
 *   → routes to scripts/reembed-with-cf-ai.ts (generates via CF AI)
 */

console.error(`
⛔  DEPRECATED — scripts/upload-embeddings.ts

This script pushed Ollama/nomic-embed-text vectors to Vectorize, which
BREAKS semantic search because the worker queries with a different model
(@cf/baai/bge-base-en-v1.5). The vector spaces are incompatible.

Run this instead:
  ADMIN_SECRET=xxx npm run upload-embeddings
  (now routes to scripts/reembed-with-cf-ai.ts — uses CF AI, correct model)
`);
process.exit(1);
