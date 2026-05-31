/**
 * Admin endpoint for bulk Vectorize operations
 */

import type { Env } from '../../shared/types';

export async function handleVectorizeUpsert(request: Request, env: Env): Promise<Response> {
  try {
    const { vectors } = await request.json() as {
      vectors: Array<{ id: string; values: number[] }>;
    };
    
    if (!vectors || !Array.isArray(vectors)) {
      return new Response('Invalid vectors array', { status: 400 });
    }
    
    await env.VECTORIZE.upsert(vectors);
    
    return new Response(JSON.stringify({ success: true, count: vectors.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Vectorize upsert error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
