#!/usr/bin/env tsx
/**
 * Generate demo cluster data without D1 access
 */

const NUM_CLUSTERS = 12;
const NUM_PAPERS = 500;

const CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.CR', 'cs.DC'];
const TITLES = [
  'Attention Is All You Need',
  'BERT: Pre-training of Deep Bidirectional Transformers',
  'Generative Adversarial Networks',
  'Deep Residual Learning for Image Recognition',
  'Adam: A Method for Stochastic Optimization',
  'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
];

function generatePapers() {
  const papers = [];
  
  for (let i = 0; i < NUM_PAPERS; i++) {
    const cluster = i % NUM_CLUSTERS;
    const category = CATEGORIES[cluster % CATEGORIES.length];
    
    // Position papers in cluster-based clouds
    const clusterAngle = (cluster / NUM_CLUSTERS) * Math.PI * 2;
    const clusterRadius = 8;
    const clusterX = Math.cos(clusterAngle) * clusterRadius;
    const clusterY = Math.sin(clusterAngle) * clusterRadius;
    
    // Add random spread within cluster
    const spreadX = (Math.random() - 0.5) * 3;
    const spreadY = (Math.random() - 0.5) * 3;
    const spreadZ = (Math.random() - 0.5) * 3;
    
    papers.push({
      id: `240${6 + Math.floor(i / 100)}.${String(i).padStart(5, '0')}`,
      title: TITLES[i % TITLES.length] + ` (Variant ${i})`,
      category,
      cluster,
      x: clusterX + spreadX,
      y: clusterY + spreadY,
      z: spreadZ
    });
  }
  
  return papers;
}

const output = {
  papers: generatePapers(),
  clusters: NUM_CLUSTERS,
  generated: new Date().toISOString()
};

import { writeFileSync } from 'fs';
writeFileSync('public/data/paper-clusters.json', JSON.stringify(output, null, 2));

console.log(`✓ Generated ${NUM_PAPERS} demo papers in public/data/paper-clusters.json`);
