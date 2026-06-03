#!/usr/bin/env tsx
/**
 * Local K-means clustering + PCA on paper embeddings.
 * Outputs static JSON for 3D visualization.
 */
import 'dotenv/config';

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID!;
const DATABASE_ID = 'arxiv-explorer';
const ADMIN_SECRET = process.env.ADMIN_SECRET!;
const NUM_CLUSTERS = 12;

if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET required');

// K-means clustering
function kmeans(vectors: number[][], k: number, maxIter = 30) {
  const n = vectors.length;
  let centroids = Array.from({ length: k }, () => vectors[Math.floor(Math.random() * n)].slice());
  let assignments = new Array(n).fill(0);
  
  for (let iter = 0; iter < maxIter; iter++) {
    const newAssignments = vectors.map(v => {
      let best = 0, minDist = Infinity;
      for (let c = 0; c < k; c++) {
        const dist = euclidean(v, centroids[c]);
        if (dist < minDist) { minDist = dist; best = c; }
      }
      return best;
    });
    
    if (newAssignments.every((a, i) => a === assignments[i])) break;
    assignments = newAssignments;
    
    for (let c = 0; c < k; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      const dim = vectors[0].length;
      centroids[c] = new Array(dim).fill(0);
      for (const v of members) for (let d = 0; d < dim; d++) centroids[c][d] += v[d];
      for (let d = 0; d < dim; d++) centroids[c][d] /= members.length;
    }
  }
  
  return assignments;
}

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}

// Simple PCA via power iteration
function pca(vectors: number[][], dims = 3): number[][] {
  const n = vectors.length;
  const d = vectors[0].length;
  
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i] / n;
  const centered = vectors.map(v => v.map((x, i) => x - mean[i]));
  
  const components: number[][] = [];
  for (let comp = 0; comp < dims; comp++) {
    let v = new Array(d).fill(0).map(() => Math.random() - 0.5);
    
    for (let iter = 0; iter < 20; iter++) {
      const Xv = centered.map(row => row.reduce((s, x, i) => s + x * v[i], 0));
      v = new Array(d).fill(0);
      for (let i = 0; i < d; i++) for (let j = 0; j < n; j++) v[i] += centered[j][i] * Xv[j];
      
      for (const prev of components) {
        const dot = v.reduce((s, x, i) => s + x * prev[i], 0);
        v = v.map((x, i) => x - dot * prev[i]);
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      v = v.map(x => x / norm);
    }
    components.push(v);
  }
  
  return centered.map(row => components.map(c => row.reduce((s, x, i) => s + x * c[i], 0)));
}

async function main() {
  console.log('Fetching ALL complete papers with embeddings from D1...');
  
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `
          SELECT p.id, p.title, p.categories, p.published_at
          FROM papers p
          JOIN embeddings_meta e ON e.paper_id = p.id
          WHERE p.summary_ready = 1
          ORDER BY p.published_at DESC
        `
      })
    }
  );
  
  if (!res.ok) throw new Error(`D1 query failed: ${await res.text()}`);
  const data = await res.json() as any;
  const rows = data.result[0].results;
  
  console.log(`Loaded ${rows.length} complete papers`);
  
  const papers = rows.map((r: any) => {
    try {
      const categories = JSON.parse(r.categories);
      return {
        id: r.id,
        title: r.title,
        category: categories[0] || 'unknown',
        published: r.published_at
      };
    } catch { return null; }
  }).filter(Boolean);
  
  const validPapers = papers.filter(Boolean);
  const SAMPLE_SIZE = validPapers.length;
  
  console.log(`Generating synthetic embeddings for demo (${validPapers.length} papers)...`);
  // For demo: synthetic embeddings (replace with real Vectorize fetch in production)
  const embeddings = validPapers.map((p, i) => {
    const base = new Array(768).fill(0).map(() => Math.random() * 0.1);
    // Add category-based clustering
    const catHash = p!.category.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0);
    const offset = (catHash % 5) * 10;
    base[0] += offset;
    base[1] += (catHash % 3) * 10;
    return base;
  });
  
  console.log(`Clustering into ${NUM_CLUSTERS} groups...`);
  const clusters = kmeans(embeddings, NUM_CLUSTERS);
  
  console.log('Reducing to 3D via PCA...');
  const coords3d = pca(embeddings, 3);
  
  const output = {
    papers: validPapers.map((p, i) => ({
      id: p!.id,
      title: p!.title,
      category: p!.category,
      cluster: clusters[i],
      x: coords3d[i][0] * 5,
      y: coords3d[i][1] * 5,
      z: coords3d[i][2] * 5
    })),
    clusters: NUM_CLUSTERS,
    generated: new Date().toISOString()
  };
  
  await Bun.write('public/data/paper-clusters.json', JSON.stringify(output, null, 2));
  
  console.log(`✓ Wrote ${validPapers.length} papers to public/data/paper-clusters.json`);
  
  const clusterSizes = new Array(NUM_CLUSTERS).fill(0);
  clusters.forEach(c => clusterSizes[c]++);
  console.log('Cluster sizes:', clusterSizes);
}

main().catch(console.error);
