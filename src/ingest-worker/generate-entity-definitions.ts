/**
 * src/ingest-worker/generate-entity-definitions.ts
 * Generate one-sentence definitions for entity names
 */

import type { Env } from '../shared/types';

const SYSTEM_PROMPT = 'You are a technical term explainer. Provide one-sentence definitions for technical terms.';

export async function generateEntityDefinition(
  entityName: string,
  env: Env
): Promise<string | null> {
  try {
    const prompt = `Define "${entityName}" in one clear sentence (max 100 characters).`;

    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 50,
    }) as { response: string };

    return response.response.trim().slice(0, 150);
  } catch (err) {
    console.error(`[entity-def] Failed to define ${entityName}:`, err);
    return null;
  }
}

export async function storeEntityDefinitions(
  entities: Array<{ name: string; type: string }>,
  env: Env
): Promise<void> {
  if (entities.length === 0) return;

  // Check which entities need definitions
  const names = entities.map(e => e.name);
  const placeholders = names.map(() => '?').join(',');
  
  const { results } = await env.DB.prepare(
    `SELECT entity_name FROM entity_definitions WHERE entity_name IN (${placeholders})`
  ).bind(...names).all<{ entity_name: string }>();

  const existing = new Set(results.map(r => r.entity_name));
  const missing = entities.filter(e => !existing.has(e.name));

  if (missing.length === 0) return;

  // Generate definitions for missing entities (one at a time to avoid rate limits)
  for (const entity of missing.slice(0, 5)) { // Max 5 per paper
    const definition = await generateEntityDefinition(entity.name, env);
    
    if (definition) {
      try {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO entity_definitions (entity_name, definition) VALUES (?, ?)`
        ).bind(entity.name, definition).run();
      } catch (err) {
        console.error(`[entity-def] Failed to store ${entity.name}:`, err);
      }
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
