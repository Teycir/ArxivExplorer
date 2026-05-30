/**
 * src/ingest-worker/generate-summary.ts
 * Generates ALL summary fields in a single Workers AI call (structured JSON).
 */

import type { SummaryFields, Env } from '../shared/types';
import { summaryModel } from '../shared/utils';

// Fallback models in order of preference
const FALLBACK_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.1',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/qwen/qwen1.5-7b-chat-awq',
];

const SYSTEM_PROMPT =
  'You are a research paper summarizer. ' +
  'Return ONLY a valid JSON object with no preamble, explanation, or markdown fences.';

const USER_PROMPT = `Summarize this research paper abstract. Return ONLY valid JSON, no other text.

Abstract:
{abstract}

JSON format:
{
  "tldr": "One clear sentence describing what this paper does",
  "key_contributions": ["contribution 1", "contribution 2"],
  "methods": ["method 1", "method 2"],
  "limitations": ["limitation 1"],
  "beginner_explain": "Simple explanation in 2-3 sentences",
  "technical_summary": "Technical description in 3-4 sentences"
}`;

export async function generateSummary(
  abstract: string,
  env: Env
): Promise<SummaryFields> {
  const primaryModel = summaryModel(env);
  const models = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];
  
  // Try Cloudflare Workers AI models
  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    try {
      const result = await generateSummaryAttempt(abstract, model, env);
      if (i > 0) {
        console.info(`[generate-summary] Success with fallback model ${i}: ${model}`);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn(`[generate-summary] Model ${model} failed:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Guaranteed fallback: extract from abstract
  console.warn(`[generate-summary] All AI models failed, using abstract-based fallback`);
  const sentences = abstract.split(/[.!?]+/).filter(s => s.trim().length > 20);
  return {
    tldr: sentences[0]?.trim() || abstract.slice(0, 200),
    key_contributions: sentences.slice(0, 2).map(s => s.trim()).filter(Boolean).length > 0 
      ? sentences.slice(0, 2).map(s => s.trim()).filter(Boolean)
      : ['Research contribution described in abstract'],
    methods: sentences.slice(2, 4).map(s => s.trim()).filter(Boolean).length > 0
      ? sentences.slice(2, 4).map(s => s.trim()).filter(Boolean)
      : ['Methodology described in paper'],
    limitations: [],
    beginner_explain: abstract.slice(0, 300),
    technical_summary: abstract.slice(0, 600),
  };
}

async function generateSummaryAttempt(
  abstract: string,
  model: string,
  env: Env
): Promise<SummaryFields> {
  const prompt = USER_PROMPT.replace('{abstract}', abstract.slice(0, 4000));

  const aiResponse = await env.AI.run(model, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2048,
    temperature: 0.3,
  }) as { response: string };

  if (!aiResponse?.response) {
    throw new Error('Workers AI returned empty response for summary generation');
  }

  let parsed: unknown;
  try {
    // Aggressive cleaning: strip markdown, code blocks, and common prefixes
    let cleaned = aiResponse.response.trim();
    
    // Remove markdown code fences
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    
    // Remove common LLM preambles
    cleaned = cleaned.replace(/^(?:Here's|Here is|Sure,?|Okay,?)[^{]*/i, '');
    
    // Find first { and last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('No JSON object found in response');
    }
    
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Summary JSON parse error: ${String(err)} — raw response: ${aiResponse.response.slice(0, 300)}`
    );
  }

  return validateSummaryFields(parsed);
}

function validateSummaryFields(raw: unknown): SummaryFields {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Summary response is not an object');
  }

  const obj = raw as Record<string, unknown>;

  const tldr = assertString(obj, 'tldr');
  const key_contributions = assertStringArray(obj, 'key_contributions', 0);
  const methods = assertStringArray(obj, 'methods', 0);
  const limitations = assertStringArray(obj, 'limitations', 0);
  const beginner_explain = assertString(obj, 'beginner_explain');
  const technical_summary = assertString(obj, 'technical_summary');

  // Ensure at least one item in required arrays
  if (key_contributions.length === 0) key_contributions.push('Research contribution');
  if (methods.length === 0) methods.push('Research methodology');

  return { tldr, key_contributions, methods, limitations, beginner_explain, technical_summary };
}

function assertString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Summary field "${key}" is missing or not a non-empty string`);
  }
  return v.trim();
}

function assertStringArray(obj: Record<string, unknown>, key: string, minLength = 1): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new Error(`Summary field "${key}" is not an array`);
  }
  const arr = v.map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`Summary field "${key}[${i}]" is not a string`);
    }
    return item.trim();
  }).filter(Boolean);

  if (arr.length < minLength) {
    throw new Error(`Summary field "${key}" has ${arr.length} items, expected at least ${minLength}`);
  }
  return arr;
}
