/**
 * src/ingest-worker/generate-entities.ts
 * Extract named ML entities (models, datasets, benchmarks) from a paper abstract.
 *
 * Runs concurrently with generateSummary() in processSinglePaper().
 * Uses a smaller/faster model — 30 s timeout, non-fatal on failure.
 *
 * Output shape stored in summaries.entities:
 *   [{ name: "BERT", type: "model" }, { name: "ImageNet", type: "dataset" }, ...]
 */

import type { EntityFields, Env } from '../shared/types';

const ENTITY_PROMPT = `You are an entity extractor for research papers.
Return ONLY a valid JSON object. No preamble.

Abstract:
{abstract}

JSON format:
{
  "models_named": ["BERT", "GPT-4", "ViT"],
  "datasets_named": ["ImageNet", "GLUE", "SQuAD"],
  "benchmarks_named": ["MMLU", "HumanEval", "HellaSwag"]
}

Only include entities explicitly named in the abstract. Return empty arrays if none found.`;

export async function generateEntities(
  abstract: string,
  env: Env
): Promise<Array<{ name: string; type: 'model' | 'dataset' | 'benchmark' }>> {
  if (!env.OLLAMA_BASE) return []; // entity extraction requires Ollama; skip if absent

  const model = env.OLLAMA_ENTITY_MODEL ?? env.OLLAMA_SUMMARY_MODEL ?? 'gemma4:e4b';
  const prompt = ENTITY_PROMPT.replace('{abstract}', abstract.slice(0, 3000));

  try {
    const res = await fetch(`${env.OLLAMA_BASE.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as { response?: string; error?: string };
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    if (!data.response?.trim()) throw new Error('Empty Ollama response');

    let cleaned = data.response.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const first = cleaned.indexOf('{');
    const last  = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON in entity response');
    cleaned = cleaned.slice(first, last + 1);

    const raw = JSON.parse(cleaned) as EntityFields;
    const entities: Array<{ name: string; type: 'model' | 'dataset' | 'benchmark' }> = [
      ...(raw.models_named    ?? []).map(n => ({ name: n, type: 'model'     as const })),
      ...(raw.datasets_named  ?? []).map(n => ({ name: n, type: 'dataset'   as const })),
      ...(raw.benchmarks_named ?? []).map(n => ({ name: n, type: 'benchmark' as const })),
    ];
    return entities;
  } catch (err) {
    console.warn(`[generate-entities] Failed (non-fatal):`, String(err));
    return [];
  }
}
