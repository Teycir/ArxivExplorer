/**
 * src/api-worker/routes/enrichment.ts
 * GET /api/paper/:id/code        — code repos from paper_code table
 * GET /api/paper/:id/benchmarks  — benchmark results from paper_benchmarks table
 */

import type { Env } from '../../shared/types';
import { getPaperCode, getPaperBenchmarks } from '../../shared/db';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handlePaperCode(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  arxivId: string
): Promise<Response> {
  const cors = corsHeaders(env);
  if (!arxivId || !/^[\w.-]+$/.test(arxivId)) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }
  try {
    const repos = await getPaperCode(env.DB, arxivId);
    return jsonResponse({ repos }, cors);
  } catch (err) {
    console.error(`[enrichment/code] DB error for ${arxivId}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}

export async function handlePaperBenchmarks(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  arxivId: string
): Promise<Response> {
  const cors = corsHeaders(env);
  if (!arxivId || !/^[\w.-]+$/.test(arxivId)) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }
  try {
    const benchmarks = await getPaperBenchmarks(env.DB, arxivId);
    return jsonResponse({ benchmarks }, cors);
  } catch (err) {
    console.error(`[enrichment/benchmarks] DB error for ${arxivId}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
