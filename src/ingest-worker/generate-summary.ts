/**
 * src/ingest-worker/generate-summary.ts
 * Generates ALL summary fields in a single Workers AI call (structured JSON).
 *
 * v1 used 5 separate prompts per paper — ~82 neurons each.
 * v2 uses 1 consolidated prompt — ~44 neurons.
 *
 * Never swallows errors — callers catch and mark paper as failed.
 */

import type { SummaryFields, Env } from '../shared/types';
import { summaryModel } from '../shared/utils';

const SYSTEM_PROMPT =
  'You are a research paper summarizer. ' +
  'Return ONLY a valid JSON object with no preamble, explanation, or markdown fences.';

const USER_PROMPT = `Summarize this paper abstract into the following JSON structure.
Be concrete and specific. Avoid vague phrases like "this paper proposes" or "we show that".

Abstract:
{abstract}

Return exactly this JSON shape:
{
  "tldr": "80-120 word summary for a technical audience. State the contribution directly.",
  "key_contributions": ["verb-led bullet 1", "verb-led bullet 2", "verb-led bullet 3"],
  "methods": ["method/technique 1", "method/technique 2", "method/technique 3"],
  "limitations": ["limitation 1", "limitation 2"],
  "beginner_explain": "100-200 word plain explanation for a software engineer with no ML background",
  "technical_summary": "200-300 word precise technical description preserving mathematical terminology"
}`;

export async function generateSummary(
  abstract: string,
  env: Env
): Promise<SummaryFields> {
  const prompt = USER_PROMPT.replace('{abstract}', abstract.slice(0, 4000));

  const aiResponse = await env.AI.run(summaryModel(env), {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1024,
  }) as { response: string };

  if (!aiResponse?.response) {
    throw new Error('Workers AI returned empty response for summary generation');
  }

  let parsed: unknown;
  try {
    // Strip accidental markdown fences if the model ignores our instruction
    const cleaned = aiResponse.response
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Summary JSON parse error: ${String(err)} — raw response: ${aiResponse.response.slice(0, 200)}`
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
  const key_contributions = assertStringArray(obj, 'key_contributions');
  const methods = assertStringArray(obj, 'methods');
  const limitations = assertStringArray(obj, 'limitations');
  const beginner_explain = assertString(obj, 'beginner_explain');
  const technical_summary = assertString(obj, 'technical_summary');

  return { tldr, key_contributions, methods, limitations, beginner_explain, technical_summary };
}

function assertString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Summary field "${key}" is missing or not a non-empty string`);
  }
  return v.trim();
}

function assertStringArray(obj: Record<string, unknown>, key: string): string[] {
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

  if (arr.length === 0) {
    throw new Error(`Summary field "${key}" is an empty array`);
  }
  return arr;
}
