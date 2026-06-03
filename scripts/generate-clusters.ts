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
      SELECT id, title, primary_category
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
    const cat = r.primary_category || 'unknown';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, clusterId++);
    }
  });

  console.log(`Generated ${clusterId} clusters`);

  // Generate 3D positions using force-directed layout simulation
  const positions = generatePositions(rows.length, edgeRows);

  const papers: Paper[] = rows.map((r: any, i: number) => ({
    id: r.id,
    title: r.title,
    category: r.primary_category || 'unknown',
    cluster: categoryMap.get(r.primary_category || 'unknown') ?? 0,
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

function generatePositions(count: number, edges: any[]): Array<{x: number; y: number; z: number}> {
  // Build adjacency map
  const adj = new Map<number, number[]>();
  const idToIndex = new Map<string, number>();
  
  // Initialize positions randomly in a sphere
  const positions = Array.from({ length: count }, () => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 15;
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    };
  });

  // Simple force-directed layout (10 iterations)
  const ITERATIONS = 10;
  const REPULSION = 0.5;
  const ATTRACTION = 0.01;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces = positions.map(() => ({ x: 0, y: 0, z: 0 }));

    // Repulsion between all pairs
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = positions[j]!.x - positions[i]!.x;
        const dy = positions[j]!.y - positions[i]!.y;
        const dz = positions[j]!.z - positions[i]!.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.01;
        const force = REPULSION / (dist * dist);
        
        forces[i]!.x -= force * dx / dist;
        forces[i]!.y -= force * dy / dist;
        forces[i]!.z -= force * dz / dist;
        forces[j]!.x += force * dx / dist;
        forces[j]!.y += force * dy / dist;
        forces[j]!.z += force * dz / dist;
      }
    }

    // Apply forces
    for (let i = 0; i < count; i++) {
      positions[i]!.x += forces[i]!.x;
      positions[i]!.y += forces[i]!.y;
      positions[i]!.z += forces[i]!.z;
    }
  }

  return positions;
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
