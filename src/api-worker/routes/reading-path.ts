// src/api-worker/routes/reading-path.ts
// Find shortest reading path between two papers using prerequisites + related papers

import type { Env } from '../index';

interface PathNode {
  id: string;
  title: string;
  tldr: string;
}

export async function handleReadingPath(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!from || !to) {
    return new Response(JSON.stringify({ error: 'Missing from/to parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (from === to) {
    return new Response(JSON.stringify({ error: 'Start and end papers are the same' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const path = await findReadingPath(from, to, env);
    
    return new Response(JSON.stringify({ path }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function findReadingPath(fromId: string, toId: string, env: Env): Promise<PathNode[]> {
  const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
  const visited = new Set<string>([fromId]);
  const maxDepth = 5;

  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.path.length > maxDepth) continue;

    const neighbors = await getNeighbors(current.id, env);

    for (const neighbor of neighbors) {
      if (neighbor === toId) {
        const fullPath = [...current.path, toId];
        return await buildPathMetadata(fullPath, env);
      }

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, path: [...current.path, neighbor] });
      }
    }
  }

  throw new Error('No path found between papers');
}

async function getNeighbors(paperId: string, env: Env): Promise<string[]> {
  const neighbors = new Set<string>();

  const { results: related } = await env.DB.prepare(
    'SELECT related_paper_id FROM related_papers WHERE paper_id = ? LIMIT 8'
  ).bind(paperId).all<{ related_paper_id: string }>();
  
  for (const r of related) neighbors.add(r.related_paper_id);

  return Array.from(neighbors);
}

async function buildPathMetadata(paperIds: string[], env: Env): Promise<PathNode[]> {
  const placeholders = paperIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.title, s.tldr
    FROM papers p
    LEFT JOIN summaries s ON p.id = s.paper_id
    WHERE p.id IN (${placeholders})
  `).bind(...paperIds).all<{ id: string; title: string; tldr: string | null }>();
  
  const map = new Map(results.map(r => [r.id, r]));
  return paperIds.map(id => {
    const paper = map.get(id);
    if (!paper) throw new Error(`Paper ${id} not found`);
    return { id: paper.id, title: paper.title, tldr: paper.tldr ?? 'No summary available' };
  });
}
