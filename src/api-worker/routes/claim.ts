/**
 * src/api-worker/routes/claim.ts
 * POST /api/classify-claim — Classify if a paper supports/contradicts a claim
 */

import type { Env } from '../../shared/types';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const SYSTEM_PROMPT = 'You are a research paper classifier. Analyze if a paper supports, contradicts, or is neutral to a given claim. Return ONLY valid JSON.';

const USER_PROMPT = `Does this paper support, contradict, or is neutral to the following claim?

Claim: {claim}

Paper abstract: {abstract}

Paper summary: {tldr}

Return ONLY valid JSON in this format:
{
  "result": "support",
  "reasoning": "One sentence explaining why"
}

result must be one of: support, contradict, neutral`;

export async function handleClassifyClaim(
  request: Request,
  env: Env
): Promise<Response> {
  const cors = corsHeaders(env);

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', cors, 405);
  }

  try {
    const body = await request.json() as { claim: string; abstract: string; tldr: string };
    
    if (!body.claim || !body.abstract) {
      return errorResponse('Missing claim or abstract', cors, 400);
    }

    const prompt = USER_PROMPT
      .replace('{claim}', body.claim)
      .replace('{abstract}', body.abstract.slice(0, 1500))
      .replace('{tldr}', body.tldr || '');

    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 200,
    }) as { response: string };

    let parsed;
    try {
      const text = response.response.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return jsonResponse({ result: 'neutral', reasoning: 'Classification failed' }, cors);
    }

    // Validate result
    if (!['support', 'contradict', 'neutral'].includes(parsed.result)) {
      parsed.result = 'neutral';
    }

    return jsonResponse(parsed, cors);
  } catch (err) {
    console.error('[classify-claim] Error:', err);
    return errorResponse(`Classification error: ${String(err)}`, cors, 500);
  }
}
