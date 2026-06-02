/**
 * src/api-worker/routes/institution.ts
 * GET /api/institution/:name — papers whose authors are affiliated with an institution.
 * Follows the same pattern as /api/topic/:slug.
 */

import type { Env } from '../../shared/types';
import { getPapersByInstitution } from '../../shared/db';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleInstitution(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  rawName: string
): Promise<Response> {
  const cors = corsHeaders(env);

  const institutionName = decodeURIComponent(rawName).trim();
  if (!institutionName) {
    return errorResponse('Missing institution name', cors, 400);
  }

  try {
    const papers = await getPapersByInstitution(env.DB, institutionName, 20);
    return jsonResponse({ institution: institutionName, papers, total: papers.length }, cors);
  } catch (err) {
    console.error(`[institution] DB error for "${institutionName}":`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
