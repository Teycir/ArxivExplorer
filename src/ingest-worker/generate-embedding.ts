/**
 * src/ingest-worker/generate-embedding.ts
 * Generates a vector embedding for a paper using Workers AI.
 * Called once per paper at ingestion time — never in the hot request path.
 */

import type { EmbeddingResponse, Env } from '../shared/types';
import { embeddingModel } from '../shared/utils';

/**
 * Generates an embedding vector for the given text.
 * Throws on failure — callers should catch and handle (mark paper as failed, etc.)
 */
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  // Truncate to avoid exceeding model token limits
  const truncated = text.slice(0, 2000);

  const response = await env.AI.run(embeddingModel(env), {
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
