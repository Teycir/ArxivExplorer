/**
 * src/api-worker/routes/entity-definitions.ts
 * GET /api/entity-definitions?names=BERT,RLHF — Fetch definitions for entities
 */

import type { Env } from '../../shared/types';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleEntityDefinitions(
  request: Request,
  env: Env
): Promise<Response> {
  const cors = corsHeaders(env);
  const url = new URL(request.url);
  const names = url.searchParams.get('names')?.split(',').map(n => n.trim()).filter(Boolean);

  if (!names || names.length === 0) {
    return errorResponse('Missing names parameter', cors, 400);
  }

  if (names.length > 20) {
    return errorResponse('Too many names (max 20)', cors, 400);
  }

  // Cap individual name length to prevent cache-key inflation and oversized DB queries
  if (names.some(n => n.length > 200)) {
    return errorResponse('Each name must be 200 characters or fewer', cors, 400);
  }

  try {
    const placeholders = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT entity_name, definition FROM entity_definitions WHERE entity_name IN (${placeholders})`
    ).bind(...names).all<{ entity_name: string; definition: string }>();

    const definitions: Record<string, string> = {};
    for (const row of results) {
      definitions[row.entity_name] = row.definition;
    }

    return jsonResponse({ definitions }, cors);
  } catch (err) {
    console.error('[entity-definitions] Error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
