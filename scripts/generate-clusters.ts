/**
 * scripts/generate-clusters.ts
 * Generate paper-clusters.json for 3D visualization with KNN edges
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface Paper {
  id: string;
  title: string;
  category: string;
  cluster: number;
  x: number;
  y: number;
  z: number;
}

interface Edge {
  source: string;
  target: string;
  strength: number;
}

interface ClusterData {
  papers: Paper[];
  edges: Edge[];
  clusters: number;
  generated: string;
}

const LIMIT = 200; // Number of papers to visualize
const KNN_K = 5;   // Use top K related papers per node

async function main() {
  console.log('Fetching papers from D1...');
  
  // Get papers with summaries
  const papersJson = execSync(
    `wrangler d1 execute arxiv-explorer --remote --json --command="
      SELECT id, title,
             COALESCE(primary_category, json_extract(categories, '$[0]'), 'cs.LG') AS primary_category
      FROM papers
      WHERE summary_ready = 1
      ORDER BY published_at DESC
      LIMIT ${LIMIT}
    "`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  );

  const papersResult = JSON.parse(papersJson);
  const rows = papersResult[0]?.results ?? [];
  
  console.log(`Loaded ${rows.length} papers`);

  if (rows.length === 0) {
    console.error('No papers found');
    process.exit(1);
  }

  // Get all related pairs
  const paperIds = rows.map((r: any) => `'${r.id}'`).join(',');
  const edgesJson = execSync(
    `wrangler d1 execute arxiv-explorer --remote --json --command="
      SELECT paper_id, related_paper_id, similarity_score
      FROM related_papers
      WHERE paper_id IN (${paperIds})
        AND related_paper_id IN (${paperIds})
        AND rank <= ${KNN_K}
      ORDER BY paper_id, rank
    "`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  );

  const edgesResult = JSON.parse(edgesJson);
  const edgeRows = edgesResult[0]?.results ?? [];
  
  console.log(`Loaded ${edgeRows.length} KNN edges`);

  // Simple clustering: assign cluster by primary category
  const categoryMap = new Map<string, number>();
  let clusterId = 0;
  
  rows.forEach((r: any) => {
    const cat = r.primary_category || 'cs.LG';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, clusterId++);
    }
  });

  console.log(`Generated ${clusterId} clusters`);

  // Generate 3D positions using cluster-aware lobe layout
  const categories = rows.map((r: any) => r.primary_category || 'cs.LG');
  const positions = generatePositions(rows.length, edgeRows, categories);

  const papers: Paper[] = rows.map((r: any, i: number) => ({
    id: r.id,
    title: r.title,
    category: r.primary_category || 'cs.LG',
    cluster: categoryMap.get(r.primary_category || 'cs.LG') ?? 0,
    x: positions[i]!.x,
    y: positions[i]!.y,
    z: positions[i]!.z,
  }));

  const edges: Edge[] = edgeRows.map((e: any) => ({
    source: e.paper_id,
    target: e.related_paper_id,
    strength: e.similarity_score,
  }));

  const data: ClusterData = {
    papers,
    edges,
    clusters: clusterId,
    generated: new Date().toISOString(),
  };

  const outPath = join(process.cwd(), 'public/data/paper-clusters.json');
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  
  console.log(`✅ Written ${papers.length} papers, ${edges.length} edges to ${outPath}`);
}

// Generate cluster-aware 3D positions.
// Each category gets its own lobe on a large sphere; papers within
// a lobe are spread with fibonacci sampling + jitter for natural look.
function generatePositions(
  count: number,
  _edges: unknown[],
  categories: string[],
): Array<{x: number; y: number; z: number}> {
  // Group indices by category
  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const cat = categories[i] ?? 'cs.LG';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(i);
  }

  const clusterKeys = Array.from(groups.keys());
  const numClusters = clusterKeys.length;
  const CLUSTER_RADIUS = 12;  // distance from origin to lobe centre
  const SPREAD = 4;            // radius of each lobe

  const positions: Array<{x: number; y: number; z: number}> = new Array(count);

  clusterKeys.forEach((cat, ci) => {
    const indices = groups.get(cat)!;
    // Distribute lobe centres evenly over a sphere surface
    const phi   = Math.acos(1 - 2 * (ci + 0.5) / numClusters);
    const theta = Math.PI * (1 + Math.sqrt(5)) * ci;
    const cx = CLUSTER_RADIUS * Math.sin(phi) * Math.cos(theta);
    const cy = CLUSTER_RADIUS * Math.sin(phi) * Math.sin(theta);
    const cz = CLUSTER_RADIUS * Math.cos(phi);

    indices.forEach((paperIdx, pi) => {
      // Fibonacci sphere sampling within lobe
      const t2 = (pi + 0.5) / indices.length;
      const p2 = Math.acos(1 - 2 * t2);
      const t3 = Math.PI * (1 + Math.sqrt(5)) * pi;
      // Deterministic jitter so same-run is reproducible
      const seed = (paperIdx * 9301 + 49297) % 233280;
      const jx = (seed / 233280 - 0.5) * 1.2;
      const jy = ((seed * 17) % 233280 / 233280 - 0.5) * 1.2;
      const jz = ((seed * 31) % 233280 / 233280 - 0.5) * 1.2;

      positions[paperIdx] = {
        x: cx + SPREAD * Math.sin(p2) * Math.cos(t3) + jx,
        y: cy + SPREAD * Math.sin(p2) * Math.sin(t3) + jy,
        z: cz + SPREAD * Math.cos(p2) + jz,
      };
    });
  });

  return positions;
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
