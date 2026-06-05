/**
 * src/api-worker/routes/concept.ts
 * GET /api/concept/:name — papers tagged with a Wikidata concept name.
 * Follows the same pattern as /api/topic/:slug.
 */

import type { Env } from '../../shared/types';
import { getPapersByConceptName } from '../../shared/db';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleConcept(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  rawName: string
): Promise<Response> {
  const cors = corsHeaders(env);

  const conceptName = decodeURIComponent(rawName).trim();
  if (!conceptName) {
    return errorResponse('Missing concept name', cors, 400);
  }
  if (conceptName.length > 200) {
    return errorResponse('Concept name too long (max 200 characters)', cors, 400);
  }

  try {
    const papers = await getPapersByConceptName(env.DB, conceptName, 20);
    return jsonResponse({ concept: conceptName, papers, total: papers.length }, cors);
  } catch (err) {
    console.error(`[concept] DB error for "${conceptName}":`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
