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

    // Length limits to prevent prompt injection and LLM token exhaustion
    if (body.claim.length > 500) {
      return errorResponse('Claim too long (max 500 characters)', cors, 400);
    }

    // Strip characters commonly used in prompt injection (newlines that break
    // the prompt structure, role-injection markers)
    const sanitize = (s: string) => s
      .replace(/[\r\n]+/g, ' ')                        // collapse newlines
      .replace(/<\|.*?\|>/g, '')                        // strip <|role|> tokens
      .replace(/\[(?:INST|SYS|SYSTEM)\]/gi, '')         // strip Llama/Mistral tags
      .replace(/###\s*(?:System|User|Assistant):/gi, '') // strip markdown role markers
      .trim();

    const safeClaim    = sanitize(body.claim).slice(0, 500);
    const safeAbstract = sanitize(body.abstract).slice(0, 1500);
    const safeTldr     = sanitize(body.tldr ?? '').slice(0, 300);

    const prompt = USER_PROMPT
      .replace('{claim}', safeClaim)
      .replace('{abstract}', safeAbstract)
      .replace('{tldr}', safeTldr);

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
