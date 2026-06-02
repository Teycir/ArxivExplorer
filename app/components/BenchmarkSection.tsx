// app/components/BenchmarkSection.tsx
// Displays benchmark results for a paper fetched from the paper_benchmarks table.
// Only rendered when paper.hasBenchmark = true.

import { Card } from './Card';
import type { PaperBenchmark } from '@/src/shared/types';
import { BarChart2, Trophy } from 'lucide-react';

interface BenchmarkSectionProps {
  benchmarks: PaperBenchmark[];
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return null;
  const colors =
    rank === 1 ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
    rank === 2 ? 'bg-slate-400/20 text-slate-300 border-slate-400/40' :
    rank === 3 ? 'bg-orange-700/20 text-orange-400 border-orange-700/40' :
                 'bg-white/5 text-white/40 border-white/10';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono rounded border ${colors}`}>
      {rank <= 3 && <Trophy size={8} />}#{rank}
    </span>
  );
}

export function BenchmarkSection({ benchmarks }: BenchmarkSectionProps) {
  if (benchmarks.length === 0) return null;

  // Group by task
  const byTask = benchmarks.reduce<Record<string, PaperBenchmark[]>>((acc, b) => {
    (acc[b.task] ??= []).push(b);
    return acc;
  }, {});

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neon-red/15">
        <BarChart2 size={14} className="text-sky-500/60" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-sky-500/60">
          Benchmarks
        </span>
        <span className="ml-auto text-[10px] font-mono text-neon-red/30">
          {benchmarks.length} result{benchmarks.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-col gap-5">
        {Object.entries(byTask).map(([task, rows]) => (
          <div key={task}>
            <p className="text-[10px] font-mono text-neon-red/50 uppercase tracking-wider mb-2">{task}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-neon-red/10">
                    <th className="text-left py-1.5 pr-4 text-[10px] text-neon-red/35 font-semibold">Dataset</th>
                    <th className="text-left py-1.5 pr-4 text-[10px] text-neon-red/35 font-semibold">Metric</th>
                    <th className="text-right py-1.5 pr-4 text-[10px] text-neon-red/35 font-semibold">Score</th>
                    <th className="text-right py-1.5 text-[10px] text-neon-red/35 font-semibold">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b, i) => (
                    <tr key={i} className="border-b border-neon-red/5 last:border-0">
                      <td className="py-2 pr-4 text-white/65">{b.dataset}</td>
                      <td className="py-2 pr-4 text-white/50">{b.metric}</td>
                      <td className="py-2 pr-4 text-right text-white/80 font-semibold">{b.value}</td>
                      <td className="py-2 text-right"><RankBadge rank={b.sotaRank} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
