'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TOPICS } from '@/lib/topics';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawNode { id: string; category: string; cluster: number; }
interface GraphMeta { total: number; clusters: number; generated: string; }
interface GraphData { nodes: RawNode[]; meta: GraphMeta; }

interface RawClusterJson {
  papers: Array<{ id: string; category: string; cluster: number; x: number; y: number; z: number }>;
  clusters: number;
  generated: string;
}

async function fetchData(): Promise<GraphData> {
  try {
    const res = await fetch('https://arxiv-api.arxivexplorer.workers.dev/api/graph', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json() as GraphData;
      if (json.nodes?.length) return json;
    }
  } catch { /* fall through */ }
  const res = await fetch('/data/paper-clusters.json');
  const raw = await res.json() as RawClusterJson;
  return {
    nodes: raw.papers.map(p => ({ id: p.id, category: p.category, cluster: p.cluster })),
    meta: { total: raw.papers.length, clusters: raw.clusters, generated: raw.generated },
  };
}

// ─── Category display names ───────────────────────────────────────────────────

const CAT_LABELS: Record<string, string> = {
  'cs.AI':  'Artificial Intelligence',
  'cs.LG':  'Machine Learning',
  'cs.CL':  'Computation & Language',
  'cs.CV':  'Computer Vision',
  'cs.CR':  'Cryptography & Security',
  'cs.RO':  'Robotics',
  'cs.SE':  'Software Engineering',
  'cs.IR':  'Information Retrieval',
  'cs.NE':  'Neural & Evolutionary',
  'cs.AR':  'Computer Architecture',
  'cs.DS':  'Data Structures',
  'cs.DC':  'Distributed Computing',
  'cs.NI':  'Networking',
  'cs.PL':  'Programming Languages',
  'cs.CC':  'Computational Complexity',
  'cs.IT':  'Information Theory',
  'cs.OS':  'Operating Systems',
  'stat.ML':'Statistics / ML',
  'cs.SD':  'Sound & Audio',
  'cs.GT':  'Game Theory',
  'cs.HC':  'Human-Computer Interaction',
  'cs.SY':  'Systems & Control',
  'eess.SP':'Signal Processing',
  'eess.SY':'Systems & Control (EE)',
  'math.NA':'Numerical Analysis',
  'q-fin.PM':'Portfolio Management',
};

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-neon-red/15 rounded-lg px-5 py-4 bg-neon-red/[0.03]">
      <p className="text-neon-red/40 font-mono text-[10px] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-white/90 font-mono text-2xl font-bold">{value}</p>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PaperCloudVis() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData().then(setData).catch(e => setError(String(e)));
  }, []);

  const categoryCounts: [string, number][] = data
    ? Array.from(
        data.nodes.reduce((map, n) => {
          map.set(n.category, (map.get(n.category) ?? 0) + 1);
          return map;
        }, new Map<string, number>()),
      ).sort((a, b) => b[1] - a[1])
    : [];

  const maxCount = categoryCounts[0]?.[1] ?? 1;

  // freshness
  let freshness = '—';
  if (data?.meta.generated) {
    try {
      const mins = Math.floor((Date.now() - new Date(data.meta.generated).getTime()) / 60000);
      freshness = mins < 2 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
    } catch { /* ignore */ }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 font-mono">

      {/* Page heading */}
      <h1 className="text-white/80 text-lg font-bold uppercase tracking-widest mb-8">
        Index Stats
      </h1>

      {error && (
        <p className="text-neon-red/50 text-sm mb-8">{error}</p>
      )}

      {/* Top stat cards */}
      {data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          <StatCard label="Total Papers" value={data.meta.total.toLocaleString()} />
          <StatCard label="Categories"   value={categoryCounts.length} />
          <StatCard label="Clusters"     value={data.meta.clusters} />
          <StatCard label="Updated"      value={freshness} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          {[0,1,2,3].map(i => (
            <div key={i} className="border border-neon-red/10 rounded-lg px-5 py-4 animate-pulse bg-neon-red/[0.02] h-20" />
          ))}
        </div>
      )}

      {/* Papers by category */}
      <section className="mb-12">
        <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-4">
          Papers by Category
        </h2>
        {data ? (
          <ul className="space-y-2">
            {categoryCounts.map(([cat, count]) => (
              <li key={cat} className="flex items-center gap-3">
                {/* bar */}
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neon-red/60 rounded-full"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                {/* label */}
                <span className="text-white/40 text-xs w-48 shrink-0 truncate">
                  {CAT_LABELS[cat] ?? cat}
                  <span className="text-white/20 ml-1 text-[10px]">({cat})</span>
                </span>
                {/* count */}
                <span className="text-white/70 text-xs font-bold tabular-nums w-12 text-right shrink-0">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-5 bg-white/5 rounded animate-pulse" style={{ width: `${60 + Math.random() * 40}%` }} />
            ))}
          </div>
        )}
      </section>

      {/* Topics / Browse */}
      <section>
        <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-4">
          Browse by Topic
        </h2>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map(t => (
            <Link
              key={t.slug}
              href={`/topic/${t.slug}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                border border-neon-red/20 text-neon-red/60 text-xs
                hover:border-neon-red/50 hover:text-neon-red/90
                hover:bg-neon-red/5 transition-all"
            >
              {t.label}
              <span className="text-neon-red/30 text-[10px]">{t.category}</span>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
