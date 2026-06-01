/**
 * src/ingest-worker/generate-summary.ts
 * Generates ALL summary fields in a single AI call (structured JSON).
 *
 * Provider priority:
 *   1. Ollama (local) — if OLLAMA_BASE is set in env, zero neuron cost
 *   2. Workers AI (remote) — falls through model list; costs ~43 neurons/paper
 *
 * If ALL providers fail → throws (caller marks paper summary_ready=2 for retry).
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
  // ── 1. Ollama (local, zero neuron cost) ──────────────────────────────────
  if (env.OLLAMA_BASE) {
    try {
      return await generateSummaryOllama(abstract, env.OLLAMA_BASE, env.OLLAMA_SUMMARY_MODEL);
    } catch (err) {
      console.warn(`[generate-summary] Ollama failed, falling back to Workers AI:`, String(err));
    }
  }

  // ── 2. Workers AI (remote, costs ~43 neurons/paper) ───────────────────────
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

  // All models exhausted — throw so processSinglePaper marks the paper as
  // failed (summary_ready=2) for later retry. Returning fabricated abstract
  // sentences and writing summary_ready=1 is worse than failing: it makes
  // garbage data appear as a completed summary with no way to detect it.
  throw new Error(
    `[generate-summary] All ${models.length} AI models exhausted — no summary produced`
  );
}

// ─── Ollama provider ───────────────────────────────────────────────────────

async function generateSummaryOllama(
  abstract: string,
  ollamaBase: string,
  modelOverride?: string
): Promise<SummaryFields> {
  const model = modelOverride ?? 'qwen2.5:3b';
  const prompt = USER_PROMPT.replace('{abstract}', abstract.slice(0, 4000));

  const res = await fetch(`${ollamaBase.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `${SYSTEM_PROMPT}\n\n${prompt}`,
      stream: false,
      format: 'json',
      options: { temperature: 0.3, num_predict: 1024 },
    }),
    // 60s timeout — Ollama on CPU can be slow for 3B+ models
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const data = await res.json() as { response?: string; error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  if (!data.response?.trim()) throw new Error('Ollama returned empty response');

  // Strip markdown fences if present
  let cleaned = data.response.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('No JSON object in Ollama response');
  cleaned = cleaned.slice(first, last + 1);

  return validateSummaryFields(JSON.parse(cleaned));
}

// ─── Workers AI provider ───────────────────────────────────────────────────

async function generateSummaryAttempt(
  abstract: string,
  model: string,
  env: Env
): Promise<SummaryFields> {
  const prompt = USER_PROMPT.replace('{abstract}', abstract.slice(0, 4000));

  // Rotate between AI accounts if additional bindings are configured.
  const aiBindings = [env.AI, (env as any).AI2, (env as any).AI3].filter(Boolean);
  if (aiBindings.length < 3) {
    console.debug(`[generate-summary] Only ${aiBindings.length} AI binding(s) available — AI2/AI3 may not be bound`);
  }
  const aiBinding = aiBindings[Math.floor(Math.random() * aiBindings.length)] || env.AI;

  const aiResponse = await aiBinding.run(model, {
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
