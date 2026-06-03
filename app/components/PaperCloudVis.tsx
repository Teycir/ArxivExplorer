'use client';

import { useEffect, useState, useRef, useMemo, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';

// ─── Theme ───────────────────────────────────────────────────────────────────

const CLUSTER_COLORS: Record<number, string> = {
  0:  '#00ff41', 1:  '#4ECDC4', 2:  '#45B7D1', 3:  '#FFA07A',
  4:  '#F7DC6F', 5:  '#BB8FCE', 6:  '#FF6B6B', 7:  '#85C1E2',
  8:  '#48C9B0', 9:  '#F8B500', 10: '#5DADE2', 11: '#EC7063',
};

const CAT_LABELS: Record<string, string> = {
  'cs.LG': 'Machine Learning',   'cs.CL': 'Computation & Language',
  'cs.CV': 'Computer Vision',    'cs.AI': 'Artificial Intelligence',
  'stat.ML': 'Statistics / ML',  'cs.IR': 'Information Retrieval',
  'cs.NE': 'Neural & Evolutionary', 'cs.RO': 'Robotics',
  'cs.AR': 'Architecture',       'cs.CR': 'Cryptography',
  'cs.DS': 'Data Structures',    'cs.SE': 'Software Engineering',
};

function clusterColor(c: number) { return CLUSTER_COLORS[c] ?? '#888888'; }
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Node { id: string; title: string; x: number; y: number; z: number; cluster: number; category: string; }
interface Edge { s: string; t: string; w: number; }
interface GraphMeta { total: number; clusters: number; generated: string; }
interface GraphData { nodes: Node[]; edges: Edge[]; meta: GraphMeta; }

interface GraphStats {
  totalPapers: number; totalEdges: number; totalClusters: number;
  avgDegree: number; density: number; topCategory: string;
  topCategoryCount: number; freshness: string;
  categoryCounts: Array<{ cat: string; cluster: number; count: number }>;
}

function deriveStats(data: GraphData): GraphStats {
  const catCount = new Map<string, number>();
  const catCluster = new Map<string, number>();
  for (const n of data.nodes) {
    catCount.set(n.category, (catCount.get(n.category) ?? 0) + 1);
    catCluster.set(n.category, n.cluster);
  }
  const categoryCounts = Array.from(catCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({ cat, cluster: catCluster.get(cat) ?? 0, count }));
  const [topCat] = categoryCounts;
  const n = data.nodes.length, e = data.edges.length;
  const maxEdges = n > 1 ? n * (n - 1) / 2 : 1;
  let freshness = 'unknown';
  try {
    const ageMin = Math.floor((Date.now() - new Date(data.meta.generated).getTime()) / 60_000);
    freshness = ageMin < 2 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
  } catch { /* ignore */ }
  return {
    totalPapers: n, totalEdges: e, totalClusters: data.meta.clusters,
    avgDegree: n > 0 ? parseFloat((2 * e / n).toFixed(1)) : 0,
    density: parseFloat((e / maxEdges * 100).toFixed(3)),
    topCategory: topCat ? (CAT_LABELS[topCat.cat] ?? topCat.cat) : '—',
    topCategoryCount: topCat?.count ?? 0,
    freshness, categoryCounts,
  };
}

// ─── Data normalisation ───────────────────────────────────────────────────────
// paper-clusters.json uses { papers, edges:{source,target,strength}, clusters, generated }
// /api/graph uses               { nodes,  edges:{s,t,w},              meta }
interface RawClusterJson {
  papers: Array<{ id: string; title: string; category: string; cluster: number; x: number; y: number; z: number }>;
  edges: Array<{ source: string; target: string; strength: number }>;
  clusters: number;
  generated: string;
}

function normaliseRawJson(raw: RawClusterJson): GraphData {
  return {
    nodes: raw.papers,
    edges: raw.edges.map(e => ({ s: e.source, t: e.target, w: e.strength })),
    meta:  { total: raw.papers.length, clusters: raw.clusters, generated: raw.generated },
  };
}

async function fetchGraphData(): Promise<GraphData> {
  // Try the live API first, fall back to bundled static file
  try {
    const apiBase = 'https://arxiv-api.arxivexplorer.workers.dev';
    const res = await fetch(`${apiBase}/api/graph`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json() as GraphData;
      if (json.nodes && json.nodes.length > 0) return json;
    }
  } catch { /* fall through */ }

  // Fall back to bundled static snapshot
  const res = await fetch('/data/paper-clusters.json');
  const raw  = await res.json() as RawClusterJson;
  return normaliseRawJson(raw);
}

// ─── Three.js dot cloud ───────────────────────────────────────────────────────

function DotCloud({
  nodes, edges, showEdges, onHover, onClick,
}: {
  nodes: Node[];
  edges: Edge[];
  showEdges: boolean;
  onHover: (id: string | null, x: number, y: number) => void;
  onClick: (id: string) => void;
}) {
  const meshRef  = useRef<THREE.InstancedMesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const { gl, camera } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  raycaster.params.Points = { threshold: 0.3 };

  // Build node index
  const nodeIndex = useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n, i) => m.set(n.id, i));
    return m;
  }, [nodes]);

  // ── Instanced dots ────────────────────────────────────────────────────────
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!meshRef.current) return;
    const m = meshRef.current;
    nodes.forEach((n, i) => {
      dummy.position.set(n.x, n.y, n.z);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      const [r, g, b] = hexToRgb(clusterColor(n.cluster));
      m.setColorAt(i, new THREE.Color(r, g, b));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [nodes, dummy]);

  // ── Edge lines ────────────────────────────────────────────────────────────
  const edgeGeometry = useMemo(() => {
    const positions: number[] = [];
    if (showEdges) {
      edges.forEach(e => {
        const si = nodeIndex.get(e.s);
        const ti = nodeIndex.get(e.t);
        if (si == null || ti == null) return;
        const s = nodes[si], t = nodes[ti];
        if (!s || !t) return;
        positions.push(s.x, s.y, s.z, t.x, t.y, t.z);
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [edges, showEdges, nodes, nodeIndex]);

  // ── Hover detection ───────────────────────────────────────────────────────
  const handlePointerMove = useCallback((e: THREE.Event & { clientX?: number; clientY?: number; nativeEvent?: MouseEvent }) => {
    if (!meshRef.current) return;
    const evt = (e as unknown as React.PointerEvent);
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((evt.clientX - rect.left) / rect.width)  * 2 - 1,
      -((evt.clientY - rect.top)  / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(meshRef.current);
    if (hits.length > 0) {
      const idx = hits[0].instanceId ?? -1;
      if (idx >= 0) onHover(nodes[idx].id, evt.clientX, evt.clientY);
    } else {
      onHover(null, 0, 0);
    }
  }, [gl, camera, raycaster, nodes, onHover]);

  const handleClick = useCallback((e: THREE.Event) => {
    if (!meshRef.current) return;
    const evt = e as unknown as React.MouseEvent;
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((evt.clientX - rect.left) / rect.width)  * 2 - 1,
      -((evt.clientY - rect.top)  / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(meshRef.current);
    if (hits.length > 0) {
      const idx = hits[0].instanceId ?? -1;
      if (idx >= 0) onClick(nodes[idx].id);
    }
  }, [gl, camera, raycaster, nodes, onClick]);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.012;
    }
    if (linesRef.current) {
      linesRef.current.rotation.y = meshRef.current?.rotation.y ?? 0;
    }
  });

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, nodes.length]}
        onPointerMove={handlePointerMove as never}
        onClick={handleClick as never}
      >
        <sphereGeometry args={[0.12, 6, 6]} />
        <meshBasicMaterial vertexColors toneMapped={false} />
      </instancedMesh>

      {showEdges && (
        <lineSegments ref={linesRef} geometry={edgeGeometry}>
          <lineBasicMaterial color="#00ff41" opacity={0.12} transparent />
        </lineSegments>
      )}
    </>
  );
}

// ─── Left panel: Research Areas ───────────────────────────────────────────────

function ResearchAreaPanel({ data }: { data: GraphData }) {
  // Unique categories seen in this dataset
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of data.nodes) {
      if (!seen.has(n.category)) seen.set(n.category, n.cluster);
    }
    return Array.from(seen.entries()).map(([cat, cluster]) => ({ cat, cluster }));
  }, [data]);

  return (
    <div className="absolute top-20 left-3 z-20 pointer-events-none">
      <div className="bg-black/70 border border-[#00ff41]/20 rounded p-3 backdrop-blur-sm min-w-[160px]">
        <p className="text-[#00ff41] font-mono text-[10px] font-bold uppercase tracking-widest mb-2">
          Research Areas
        </p>
        <ul className="space-y-1">
          {categories.map(({ cat, cluster }) => (
            <li key={cat} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: clusterColor(cluster) }}
              />
              <span className="text-[10px] font-mono text-[#00ff41]/70">
                {CAT_LABELS[cat] ?? cat}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[#00ff41]/30 font-mono text-[9px] mt-3">Drag · Scroll to zoom</p>
        <p className="text-[#00ff41]/30 font-mono text-[9px]">Click a dot to open paper</p>
      </div>
    </div>
  );
}

// ─── Right panel: Graph Stats ─────────────────────────────────────────────────

function GraphStatsPanel({ stats }: { stats: GraphStats }) {
  const maxCount = stats.categoryCounts[0]?.count ?? 1;

  return (
    <div className="absolute top-20 right-3 z-20 pointer-events-none">
      <div className="bg-black/70 border border-[#00ff41]/20 rounded p-3 backdrop-blur-sm w-48">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00ff41] animate-pulse" />
          <p className="text-[#00ff41] font-mono text-[10px] font-bold uppercase tracking-widest">
            Graph Stats
          </p>
        </div>

        {([
          ['PAPERS',        stats.totalPapers.toLocaleString(), ''],
          ['KNN EDGES',     stats.totalEdges.toLocaleString(),  ''],
          ['CLUSTERS',      String(stats.totalClusters),        ''],
          ['AVG DEGREE',    String(stats.avgDegree),            'edges / node'],
          ['GRAPH DENSITY', `${stats.density}%`,                ''],
        ] as [string, string, string][]).map(([label, value, sub]) => (
          <div key={label} className="flex justify-between items-start mb-2">
            <span className="text-[#00ff41]/40 font-mono text-[9px] uppercase">{label}</span>
            <div className="text-right">
              <span className="text-[#00ff41] font-mono text-[11px] font-bold">{value}</span>
              {sub && <div className="text-[#00ff41]/30 font-mono text-[8px]">{sub}</div>}
            </div>
          </div>
        ))}

        <div className="flex justify-between items-start mb-2">
          <span className="text-[#00ff41]/40 font-mono text-[9px] uppercase">TOP CATEGORY</span>
          <div className="text-right max-w-[100px]">
            <span className="text-[#00ff41] font-mono text-[11px] font-bold">{stats.topCategoryCount}</span>
            <div className="text-[#00ff41]/50 font-mono text-[8px] leading-tight">{stats.topCategory}</div>
          </div>
        </div>

        <div className="flex justify-between mb-3">
          <span className="text-[#00ff41]/40 font-mono text-[9px] uppercase">DATA AGE</span>
          <span className="text-[#00ff41] font-mono text-[11px] font-bold">{stats.freshness}</span>
        </div>

        <p className="text-[#00ff41]/40 font-mono text-[9px] uppercase mb-1">By Category</p>
        {stats.categoryCounts.slice(0, 8).map(({ cat, cluster, count }) => (
          <div key={cat} className="flex items-center gap-1 mb-0.5">
            <span className="text-[#00ff41]/50 font-mono text-[8px] w-6 text-right shrink-0">{count}</span>
            <div className="flex-1 h-1 bg-[#00ff41]/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(count / maxCount) * 100}%`,
                  backgroundColor: clusterColor(cluster),
                }}
              />
            </div>
            <span className="text-[#00ff41]/40 font-mono text-[8px] shrink-0">{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Hover tooltip ────────────────────────────────────────────────────────────

function Tooltip({ id, nodes, x, y }: { id: string | null; nodes: Node[]; x: number; y: number }) {
  const node = id ? nodes.find(n => n.id === id) : null;
  if (!node) return null;
  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="bg-black/90 border border-[#00ff41]/30 rounded px-2 py-1 max-w-[260px]">
        <p className="text-[#00ff41] font-mono text-[10px] leading-tight line-clamp-2">{node.title}</p>
        <p className="text-[#00ff41]/40 font-mono text-[9px] mt-0.5">{node.id} · {CAT_LABELS[node.category] ?? node.category}</p>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function PaperCloudVis() {
  const router = useRouter();
  const [data,       setData]       = useState<GraphData | null>(null);
  const [stats,      setStats]      = useState<GraphStats | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [showEdges,  setShowEdges]  = useState(true);
  const [hoverId,    setHoverId]    = useState<string | null>(null);
  const [hoverPos,   setHoverPos]   = useState({ x: 0, y: 0 });

  useEffect(() => {
    fetchGraphData()
      .then(d => { setData(d); setStats(deriveStats(d)); })
      .catch(e => setError(String(e)));
  }, []);

  const handleHover = useCallback((id: string | null, x: number, y: number) => {
    setHoverId(id);
    setHoverPos({ x, y });
  }, []);

  const handleClick = useCallback((id: string) => {
    router.push(`/paper/${id}`);
  }, [router]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <p className="text-[#00ff41]/40 font-mono text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-56px)] bg-[#0a0a0a]">
      {/* Loading state */}
      {!data && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-[#00ff41]/30 border-t-[#00ff41] rounded-full animate-spin" />
            <p className="text-[#00ff41]/40 font-mono text-xs">Loading graph…</p>
          </div>
        </div>
      )}

      {/* 3D canvas */}
      <Canvas
        camera={{ position: [0, 0, 35], fov: 60, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#0a0a0a' }}
        dpr={[1, 1.5]}
      >
        <Stars radius={120} depth={60} count={3000} factor={4} saturation={0} fade speed={0.4} />
        <ambientLight intensity={0.8} />

        {data && (
          <Suspense fallback={null}>
            <DotCloud
              nodes={data.nodes}
              edges={data.edges}
              showEdges={showEdges}
              onHover={handleHover}
              onClick={handleClick}
            />
          </Suspense>
        )}

        <OrbitControls
          enableDamping
          dampingFactor={0.07}
          rotateSpeed={0.5}
          zoomSpeed={0.8}
          minDistance={5}
          maxDistance={120}
        />
      </Canvas>

      {/* Panels (only after data loads) */}
      {data && stats && (
        <>
          <ResearchAreaPanel data={data} />
          <GraphStatsPanel stats={stats} />
        </>
      )}

      {/* Edges toggle */}
      <button
        onClick={() => setShowEdges(v => !v)}
        className={[
          'absolute bottom-6 left-1/2 -translate-x-1/2 z-20',
          'px-4 py-2 font-mono text-[10px] uppercase tracking-wider',
          'border rounded transition-all duration-200',
          showEdges
            ? 'border-[#00ff41]/40 text-[#00ff41]/70 bg-[#00ff41]/5 hover:bg-[#00ff41]/10'
            : 'border-[#00ff41]/15 text-[#00ff41]/30 hover:border-[#00ff41]/30',
        ].join(' ')}
      >
        {showEdges ? 'Hide edges' : 'Show edges'}
      </button>

      {/* Hover tooltip */}
      <Tooltip id={hoverId} nodes={data?.nodes ?? []} x={hoverPos.x} y={hoverPos.y} />
    </div>
  );
}
