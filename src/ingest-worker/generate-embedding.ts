/**
 * src/ingest-worker/generate-embedding.ts
 * Generates a vector embedding for a paper using Workers AI or Ollama.
 *
 * Provider priority:
 *   1. Ollama (local) — if OLLAMA_BASE is set, zero neuron cost
 *   2. Workers AI (remote) — costs ~1 neuron/paper
 *
 * Called once per paper at ingestion time — never in the hot request path.
 */

import type { EmbeddingResponse, Env } from '../shared/types';
import { embeddingModel } from '../shared/utils';

/**
 * Generates an embedding vector for the given text.
 * Throws on failure — callers should catch and handle (mark paper as failed).
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  // ── 1. Ollama (local, zero neuron cost) ──────────────────────────────────
  if (env.OLLAMA_BASE) {
    try {
      return await generateEmbeddingOllama(text, env.OLLAMA_BASE, env.OLLAMA_EMBEDDING_MODEL);
    } catch (err) {
      console.warn(`[generate-embedding] Ollama failed, falling back to Workers AI:`, String(err));
    }
  }

  // ── 2. Workers AI (remote, costs ~1 neuron/paper) ─────────────────────────
  return generateEmbeddingWorkersAI(text, env);
}

// ─── Ollama provider ───────────────────────────────────────────────────────

async function generateEmbeddingOllama(
  text: string,
  ollamaBase: string,
  modelOverride?: string
): Promise<number[]> {
  const model = modelOverride ?? 'nomic-embed-text';
  const truncated = text.slice(0, 2000);

  const res = await fetch(`${ollamaBase.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: truncated }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama embeddings HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const data = await res.json() as { embedding?: number[]; error?: string };
  if (data.error) throw new Error(`Ollama embeddings error: ${data.error}`);
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error('Ollama returned empty embedding');
  }

  return data.embedding;
}

// ─── Workers AI provider ───────────────────────────────────────────────────

async function generateEmbeddingWorkersAI(text: string, env: Env): Promise<number[]> {
  const truncated = text.slice(0, 2000);

  // Rotate between AI accounts if additional bindings are configured.
  // Filter out undefined so unbound AI2/AI3 don't silently reduce the pool.
  const aiBindings = [env.AI, (env as any).AI2, (env as any).AI3].filter(Boolean);
  if (aiBindings.length < 3 && ((env as any).AI2 === undefined || (env as any).AI3 === undefined)) {
    // Only warn once per worker invocation — this fires at ingest time, not in hot path.
    console.debug(`[generate-embedding] Only ${aiBindings.length} AI binding(s) available — AI2/AI3 not bound`);
  }
  const aiBinding = aiBindings[Math.floor(Math.random() * aiBindings.length)] || env.AI;

  const response = await aiBinding.run(embeddingModel(env), {
    text: [truncated],
  }) as unknown as EmbeddingResponse;

  if (!response?.data?.[0] || !Array.isArray(response.data[0])) {
    throw new Error(
      `Workers AI embedding returned unexpected shape: ${JSON.stringify(response)?.slice(0, 200)}`
    );
  }

  return response.data[0];
}

/**
 * Upserts a vector into Vectorize.
 * Throws on failure.
 */
export async function upsertToVectorize(
  env: Env,
  paperId: string,
  publishedAt: string,
  categories: string[],
  embedding: number[]
): Promise<string> {
  const vectorizeId = `paper-${paperId}`;

  await env.VECTORIZE.upsert([
    {
      id: vectorizeId,
      values: embedding,
      metadata: {
        paper_id: paperId,
        published_at: publishedAt,
        categories: categories.join(','),
      },
    },
  ]);

  return vectorizeId;
}
