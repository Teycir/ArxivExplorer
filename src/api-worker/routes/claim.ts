/**
 * src/api-worker/routes/claim.ts
 * POST /api/classify-claim — Classify if a paper supports/contradicts a claim
 */

import type { Env } from '../../shared/types';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';
import { sanitizeQuery } from '../../shared/sanitize';
import { checkRateLimit, getClientIP } from '../middleware/rate-limit';

const SYSTEM_PROMPT = 'You are a research paper classifier. Analyze if a paper supports, contradicts, or is neutral to a given claim. Think step-by-step before concluding. Return ONLY valid JSON.';

const USER_PROMPT = `Classify whether this paper supports, contradicts, or is neutral to the claim.

Claim: {claim}

Paper abstract: {abstract}

Paper summary: {tldr}

Instructions:
1. First, identify the key concepts in the claim
2. Check if the paper addresses those concepts
3. Determine if the paper's findings align with (support), contradict, or don't address the claim
4. Only mark as neutral if the paper is truly unrelated to the claim's domain

Classification rules:
- "support": Paper provides evidence that validates the claim
- "contradict": Paper provides evidence that refutes the claim
- "neutral": Paper does not address the claim OR discusses the topic without taking a position

Return ONLY this JSON format:
{
  "result": "support",
  "confidence": 0.85,
  "reasoning": "One clear sentence explaining why this classification was chosen"
}

result must be exactly one of: support, contradict, neutral
confidence must be between 0.0 (uncertain) and 1.0 (certain)`;

export async function handleClassifyClaim(
  request: Request,
  env: Env
): Promise<Response> {
  const cors = corsHeaders(env);

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', cors, 405);
  }

  // Rate limit: 10 requests per minute per IP
  const ip = getClientIP(request);
  const rateLimit = await checkRateLimit(env.CACHE, ip, {
    maxRequests: 10,
    windowSeconds: 60,
    lockoutSeconds: 120,
  });

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: rateLimit.resetIn,
      }),
      {
        status: 429,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetIn ?? 60),
        },
      }
    );
  }

  try {
    const body = await request.json() as { claim: string; abstract: string; tldr: string };
    
    if (!body.claim || !body.abstract) {
      return errorResponse('Missing claim or abstract', cors, 400);
    }

    // Hard max_chars check before prompt assembly
    if (body.claim.length > 500 || body.abstract.length > 2000) {
      return errorResponse('Input too long (claim: max 500, abstract: max 2000 characters)', cors, 413);
    }

    const safeClaim    = sanitizeQuery(body.claim);
    const safeAbstract = sanitizeQuery(body.abstract);
    const safeTldr     = sanitizeQuery(body.tldr ?? '');

    const prompt = USER_PROMPT
      .replace('{claim}', safeClaim)
      .replace('{abstract}', safeAbstract)
      .replace('{tldr}', safeTldr);

    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 400,
    }) as { response: string };

    let parsed;
    try {
      const text = response.response.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return jsonResponse({ result: 'neutral', confidence: 0.0, reasoning: 'Classification failed' }, cors);
    }

    // Validate result
    if (!['support', 'contradict', 'neutral'].includes(parsed.result)) {
      parsed.result = 'neutral';
    }

    // Validate confidence (default to 0.5 if missing)
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0.5;
    }

    return jsonResponse(parsed, cors);
  } catch (err) {
    console.error('[classify-claim] Error:', err);
    
    const errStr = String(err);
    
    // Check for rate limit / token exhaustion
    if (errStr.includes('rate limit') || errStr.includes('quota') || errStr.includes('429')) {
      return jsonResponse({
        error: 'AI service temporarily unavailable due to high demand. Please try again in a few minutes.',
        retryAfter: 120
      }, cors, 429);
    }
    
    if (errStr.includes('token') || errStr.includes('length') || errStr.includes('too long')) {
      return errorResponse('Input too long. Try a shorter claim or abstract.', cors, 413);
    }
    
    // Generic error - don't leak internal details
    return errorResponse('Classification service temporarily unavailable', cors, 500);
  }
}
