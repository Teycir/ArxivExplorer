/**
 * src/ingest-worker/generate-summary.ts
 * Generates ALL summary fields in a single AI call (structured JSON).
 *
 * Provider priority:
 *   1. Ollama (local) — if OLLAMA_BASE is set in env, zero neuron cost
 *   2. Workers AI (remote) — cascades through the live model list from
 *      ../shared/ai-models.ts; costs ~43 neurons/paper
 *
 * The Workers AI model list is NOT hard-coded here (see the Aug–Sep 2026
 * outage in ../shared/ai-models.ts's header) — it is discovered from
 * developers.cloudflare.com/workers-ai/models/index.md, cached in KV, and
 * tried in order via runCascade. A retired/renamed model degrades this run's
 * latency, not its correctness, and self-heals on the next discovery refresh.
 *
 * If ALL providers fail → throws AllModelsFailedError (or the Ollama error),
 * which processSinglePaper wraps as PaperFailure so the retry queue and any
 * log line say exactly which stage and why.
 */

import type { SummaryFields, Env } from '../shared/types';
import { getTextModelCascade, runCascade } from '../shared/ai-models';

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
  "technical_summary": "Technical description in 3-4 sentences",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "paper_type": "empirical",
  "novelty": "One sentence describing what is novel compared to prior work",
  "problem_statement": "One sentence describing what problem this paper solves or what was broken before",
  "applications": ["application 1", "application 2"],
  "prerequisites": ["concept 1", "concept 2"],
  "follow_up_questions": ["Question 1?", "Question 2?"]
}

paper_type must be one of: empirical, theoretical, survey, dataset, position, tutorial, unknown.`;

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
  // env.CACHE may be undefined only in ad-hoc scripts; the ingest worker
  // always binds it. getTextModelCascade tolerates undefined by using the
  // built-in defaults, so this never throws before the cascade even starts.
  const { models } = await getTextModelCascade(env.CACHE, env.SUMMARY_MODEL);

  const { value } = await runCascade(
    'summary',
    models,
    (model) => generateSummaryAttempt(abstract, model, env),
  );
  return value;
}

// ─── Ollama provider ───────────────────────────────────────────────────────

async function generateSummaryOllama(
  abstract: string,
  ollamaBase: string,
  modelOverride?: string
): Promise<SummaryFields> {
  const model = modelOverride ?? 'gemma4:e4b';
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

  // Extended fields — all non-fatal with safe fallbacks
  const keywords = softStringArray(obj, 'keywords');
  const paper_type = softString(obj, 'paper_type', 'unknown');
  const novelty = softString(obj, 'novelty', '');
  // Requested by the prompt and persisted by pipeline.ts, but this function used
  // to drop it, so summaries.problem_statement was NULL for every paper ever
  // summarised. Optional: an empty string means "model did not provide one".
  const problem_statement = softString(obj, 'problem_statement', '');
  const applications = softStringArray(obj, 'applications');
  const prerequisites = softStringArray(obj, 'prerequisites');
  const follow_up_questions = softStringArray(obj, 'follow_up_questions');

  const VALID_TYPES = new Set(['empirical','theoretical','survey','dataset','position','tutorial','unknown']);
  const normalizedType = VALID_TYPES.has(paper_type) ? paper_type : 'unknown';

  return {
    tldr, key_contributions, methods, limitations, beginner_explain, technical_summary,
    keywords, paper_type: normalizedType, novelty, applications, prerequisites, follow_up_questions,
    // Only when non-empty, so `problem_statement ?? null` in pipeline.ts stores
    // NULL (= "not provided") rather than an empty string.
    ...(problem_statement ? { problem_statement } : {}),
  };
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

/** Non-throwing string helper — returns fallback on missing/invalid */
function softString(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

/** Non-throwing array helper — returns [] on missing/invalid */
function softStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter(item => typeof item === 'string' && item.trim()).map(item => (item as string).trim());
}
