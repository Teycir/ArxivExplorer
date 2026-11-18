/**
 * src/api-worker/routes/claim.ts
 * POST /api/classify-claim — Classify if a paper supports/contradicts a claim
 */

import type { Env } from '../../shared/types';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';
import { sanitizeQuery } from '../../shared/sanitize';
import { checkRateLimit, getClientIP, INTERNAL_BUCKET } from '../middleware/rate-limit';
import { getTextModelCascade, runCascade } from '../../shared/ai-models';
import { AllModelsFailedError } from '../../shared/ai-errors';

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

  // Rate limit: 50 classify requests per minute per IP.
  // One claim search fires up to 15 concurrent classify calls, so the old
  // limit of 10/min was structurally too low — it fired on the very first
  // search. 50/min gives ~3 full searches per minute per user with headroom.
  // Lockout reduced to 30s (was 120s) so a burst doesn't block the user for 2min.
  //
  // Per-user accounting needs a trusted client IP. The Next.js proxy forwards it
  // as `X-Real-IP`, but that header is only honoured when it is authenticated
  // with INTERNAL_TOKEN (see getClientIP) — otherwise anyone could spoof their
  // way past this limit. Until that secret is configured on both workers, all
  // proxied claim traffic shares the INTERNAL_BUCKET, so that bucket gets a
  // higher ceiling: real users must never be throttled by each other, while a
  // runaway loop is still bounded (this is the only AI-costly endpoint).
  const ip = getClientIP(request, env.INTERNAL_TOKEN);
  const internal = ip === INTERNAL_BUCKET;
  const rateLimit = await checkRateLimit(env.CACHE, ip, {
    maxRequests: internal ? 300 : 50,
    windowSeconds: 60,
    lockoutSeconds: 30,
    namespace: 'claim',
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

  // Shared per-UTC-day flag: after quota exhaustion every call is a wasted AI round-trip.
  const quotaKey = `ai:quota:${new Date().toISOString().slice(0, 10)}`;

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

    // Model names rotate (llama-3.1-8b-instruct was retired 2026-05-30, error
    // 5028), so never hard-code one: use the shared cascade, which skips retired
    // models and falls through to the next working one.
    if (await env.CACHE.get(quotaKey).catch(() => null)) {
      return jsonResponse({ error: 'AI daily capacity reached. Try again after 00:00 UTC.', retryAfter: 3600 }, cors, 429);
    }

    const { models } = await getTextModelCascade(env.CACHE, env.SUMMARY_MODEL);
    const { value: response } = await runCascade(
      'classify-claim',
      models,
      (model) => env.AI.run(model as Parameters<typeof env.AI.run>[0], {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_tokens: 400,
      }) as Promise<{ response: string }>,
    );

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

    // Every model in the cascade failed: map by the dominant cause. Handled
    // first because the message lists each model's error text, which would
    // otherwise trip the substring checks below ("token", "length", ...).
    if (err instanceof AllModelsFailedError) {
      const code = err.dominantCode;
      if (code === 'quota_exhausted' || code === 'rate_limited') {
        if (code === 'quota_exhausted') {
          await env.CACHE.put(quotaKey, '1', { expirationTtl: 86400 }).catch(() => {});
        }
        return jsonResponse({
          error: 'AI service temporarily unavailable due to high demand. Please try again in a few minutes.',
          retryAfter: 120
        }, cors, 429);
      }
      return errorResponse('Classification service temporarily unavailable', cors, 503);
    }
    
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
