/**
 * src/api-worker/routes/graph.ts
 * GET /api/graph — KNN graph data for the 3-D exploration view.
 *
 * Returns a compact JSON payload:
 *   nodes  – one entry per paper: { id, title, x, y, z, cluster, category }
 *   edges  – KNN edges from related_papers: { s, t, w }  (source, target, weight)
 *   meta   – { total, clusters, generated }
 *
 * Positions are derived from the Vectorize metadata (published_at → z axis
 * used as a temporal spread) plus a deterministic jitter so papers from the
 * same date don't stack. True 3-D layout would require UMAP/t-SNE which
 * can't run in a Worker, so we use a category-bucketed spherical layout that
 * gives a visually meaningful cluster structure without offline preprocessing.
 *
 * Cache: 6 h KV (graph rarely changes mid-day; ingest busts it).
 */

import type { Env } from '../../shared/types';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const KV_GRAPH     = 'kv:graph:v2';
const TTL_GRAPH    = 6 * 3600;   // 6 h
const MAX_NODES    = 2000;        // cap so the browser doesn't choke
const KNN_K        = 5;           // edges per node shown in graph

// Stable category → hue mapping (matching CLUSTER_COLORS in the component)
const CAT_CLUSTER: Record<string, number> = {
  'cs.LG': 0, 'cs.CL': 1, 'cs.CV': 2, 'cs.AI': 3,
  'stat.ML': 4, 'cs.IR': 5, 'cs.NE': 6, 'cs.RO': 7,
  'cs.AR': 8, 'cs.CR': 9, 'cs.DS': 10, 'cs.SE': 11,
};

interface NodeRow {
  id: string;
  title: string;
  categories: string;   // JSON string
  published_at: string;
  indexed_at: string;
}

interface EdgeRow {
  paper_id: string;
  related_paper_id: string;
  similarity_score: number;
}

// ─── Deterministic pseudo-random from string ──────────────────────────────
function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 0xffffffff;
}

// ─── Layout: cluster-in-sphere ────────────────────────────────────────────
// Each category cluster occupies a "lobe" of a sphere.
// Within each lobe, papers are spread by fibonacci sphere sampling + jitter.
function computePositions(rows: NodeRow[]): Map<string, { x: number; y: number; z: number; cluster: number; category: string }> {
  // Group by primary category
  const groups = new Map<string, NodeRow[]>();
  for (const r of rows) {
    let cats: string[] = [];
    try { cats = JSON.parse(r.categories); } catch { cats = ['cs.LG']; }
    const primary = cats[0] ?? 'cs.LG';
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)!.push(r);
  }

  const clusterKeys = Array.from(groups.keys());
  const numClusters = clusterKeys.length;
  const CLUSTER_RADIUS = 12;  // distance from origin to cluster centre
  const SPREAD = 4;            // radius of the lobe around each cluster centre

  const out = new Map<string, { x: number; y: number; z: number; cluster: number; category: string }>();

  clusterKeys.forEach((cat, ci) => {
    const papers = groups.get(cat)!;
    // Place cluster centre on sphere surface
    const phi   = Math.acos(1 - 2 * (ci + 0.5) / numClusters);
    const theta = Math.PI * (1 + Math.sqrt(5)) * ci;
    const cx = CLUSTER_RADIUS * Math.sin(phi) * Math.cos(theta);
    const cy = CLUSTER_RADIUS * Math.sin(phi) * Math.sin(theta);
    const cz = CLUSTER_RADIUS * Math.cos(phi);

    const cluster = CAT_CLUSTER[cat] ?? (ci % 12);

    papers.forEach((r, pi) => {
      // Fibonacci sphere sampling within the lobe
      const t  = (pi + 0.5) / papers.length;
      const p2 = Math.acos(1 - 2 * t);
      const t2 = Math.PI * (1 + Math.sqrt(5)) * pi;
      const jx = hashNum(r.id + 'x') * 0.6 - 0.3;
      const jy = hashNum(r.id + 'y') * 0.6 - 0.3;
      const jz = hashNum(r.id + 'z') * 0.6 - 0.3;

      out.set(r.id, {
        x: cx + SPREAD * Math.sin(p2) * Math.cos(t2) + jx,
        y: cy + SPREAD * Math.sin(p2) * Math.sin(t2) + jy,
        z: cz + SPREAD * Math.cos(p2) + jz,
        cluster,
        category: cat,
      });
    });
  });

  return out;
}

export async function handleGraph(
  _request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  // 1. KV cache
  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_GRAPH);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch (err) {
    console.warn('[graph] KV read error:', err);
  }

  // 2. Fetch papers from D1
  let paperRows: NodeRow[];
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, title, categories, published_at, indexed_at
      FROM papers
      WHERE summary_ready = 1
      ORDER BY indexed_at DESC
      LIMIT ?
    `).bind(MAX_NODES).all<NodeRow>();
    paperRows = results;
  } catch (err) {
    console.error('[graph] D1 papers error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  if (paperRows.length === 0) {
    return jsonResponse({ nodes: [], edges: [], meta: { total: 0, clusters: 0, generated: new Date().toISOString() } }, cors);
  }

  // 3. Fetch KNN edges from related_papers
  const paperIds = paperRows.map(r => r.id);
  let edgeRows: EdgeRow[] = [];
  try {
    // Fetch top-K edges per paper in one query using a subquery trick
    // (D1 / SQLite doesn't support LATERAL but we can LIMIT globally and deduplicate)
    const placeholders = paperIds.slice(0, 500).map(() => '?').join(',');
    const { results } = await env.DB.prepare(`
      SELECT paper_id, related_paper_id, similarity_score
      FROM related_papers
      WHERE paper_id IN (${placeholders})
        AND rank <= ${KNN_K}
      ORDER BY paper_id, rank ASC
    `).bind(...paperIds.slice(0, 500)).all<EdgeRow>();
    edgeRows = results;
  } catch (err) {
    console.warn('[graph] D1 edges error (non-fatal):', err);
  }

  // 4. Compute positions
  const posMap = computePositions(paperRows);

  // 5. Build output
  const nodes = paperRows
    .filter(r => posMap.has(r.id))
    .map(r => {
      const pos = posMap.get(r.id)!;
      return {
        id: r.id,
        title: r.title.slice(0, 120),  // trim long titles
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        z: Math.round(pos.z * 100) / 100,
        cluster: pos.cluster,
        category: pos.category,
      };
    });

  // Only include edges where both endpoints are in the node set
  const nodeSet = new Set(nodes.map(n => n.id));
  const edges = edgeRows
    .filter(e => nodeSet.has(e.paper_id) && nodeSet.has(e.related_paper_id))
    .map(e => ({
      s: e.paper_id,
      t: e.related_paper_id,
      w: Math.round(e.similarity_score * 1000) / 1000,
    }));

  const uniqueClusters = new Set(nodes.map(n => n.cluster)).size;

  const payload = {
    nodes,
    edges,
    meta: {
      total: nodes.length,
      clusters: uniqueClusters,
      generated: new Date().toISOString(),
    },
  };

  // 6. Cache
  kvPutAsync(ctx, env.CACHE, KV_GRAPH, payload, TTL_GRAPH);

  return jsonResponse(payload, cors);
}
