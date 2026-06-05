// app/components/PaperLabel.tsx
// Compact "nutritional label" showing paper metadata at a glance

'use client';

import { Card } from './Card';
import { FileText, Lightbulb, Code, BookOpen } from 'lucide-react';
import type { PaperWithSummary } from '@/src/shared/types';

export function PaperLabel({ paper }: { paper: PaperWithSummary }) {
  const s = paper.summary;
  const rows: Array<{ label: string; value: React.ReactNode; icon?: React.ReactNode }> = [];

  if (s?.paperType) {
    rows.push({
      label: 'Type',
      value: s.paperType.charAt(0).toUpperCase() + s.paperType.slice(1),
      icon: <FileText size={11} className="text-neon-red/40" />
    });
  }

  if (s?.novelty) {
    const noveltyLevel = s.novelty.toLowerCase().includes('high') ? 'High' :
                         s.novelty.toLowerCase().includes('medium') ? 'Medium' :
                         s.novelty.toLowerCase().includes('low') ? 'Low' : 'Notable';
    rows.push({
      label: 'Novelty',
      value: noveltyLevel,
      icon: <Lightbulb size={11} className="text-amber-400/40" />
    });
  }

  if (paper.codeCount !== undefined && paper.codeCount > 0) {
    rows.push({
      label: 'Code',
      value: `✓ (${paper.codeCount} repo${paper.codeCount > 1 ? 's' : ''})`,
      icon: <Code size={11} className="text-green-400/40" />
    });
  }

  if (paper.influentialCitationCount !== undefined && paper.influentialCitationCount > 0) {
    rows.push({
      label: 'Influential',
      value: `${paper.influentialCitationCount}× cited`,
      icon: <BookOpen size={11} className="text-violet-400/40" />
    });
  }

  if (paper.referenceCount !== undefined && paper.referenceCount > 0) {
    rows.push({
      label: 'References',
      value: `${paper.referenceCount} papers`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neon-red/15">
          <FileText size={13} className="text-neon-red/50" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neon-red/50">
            Paper Label
          </span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 text-xs border-b border-white/5 last:border-0">
            <span className="flex items-center gap-1.5 text-white/40 font-mono">
              {row.icon}
              {row.label}
            </span>
            <span className="text-white/70 font-semibold">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
