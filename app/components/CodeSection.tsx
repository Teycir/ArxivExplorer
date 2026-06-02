// app/components/CodeSection.tsx
// Displays code repositories for a paper fetched from the paper_code table.
// Only rendered when paper.codeCount > 0.

import { Card } from './Card';
import type { PaperCode } from '@/src/shared/types';
import { Code, Star, ExternalLink } from 'lucide-react';

interface CodeSectionProps {
  repos: PaperCode[];
}

const FRAMEWORK_COLORS: Record<string, string> = {
  pytorch:    'border-orange-500/30 text-orange-400/80',
  tensorflow: 'border-amber-500/30 text-amber-400/80',
  jax:        'border-purple-500/30 text-purple-400/80',
  mxnet:      'border-green-500/30 text-green-400/80',
};

export function CodeSection({ repos }: CodeSectionProps) {
  if (repos.length === 0) return null;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neon-red/15">
        <Code size={14} className="text-emerald-500/60" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-500/60">
          Code
        </span>
        <span className="ml-auto text-[10px] font-mono text-neon-red/30">
          {repos.length} repo{repos.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {repos.map((repo) => {
          const host = (() => {
            try { return new URL(repo.repoUrl).hostname.replace('www.', ''); } catch { return repo.repoUrl; }
          })();
          const frameworkColor = repo.framework
            ? FRAMEWORK_COLORS[repo.framework.toLowerCase()] ?? 'border-white/10 text-white/40'
            : null;

          return (
            <a
              key={repo.repoUrl}
              href={repo.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-3 p-2.5 rounded-lg
                border border-neon-red/10 bg-neon-red/5
                hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all group"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-xs font-mono text-white/70 group-hover:text-white/90 truncate transition-colors">
                  {host}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {repo.isOfficial && (
                    <span className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-emerald-500/40 text-emerald-400/80 bg-emerald-500/10">
                      Official
                    </span>
                  )}
                  {repo.framework && frameworkColor && (
                    <span className={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${frameworkColor} bg-transparent`}>
                      {repo.framework}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-mono text-neon-red/40 shrink-0">
                {repo.stars > 0 && (
                  <><Star size={10} className="text-amber-400/50" />{repo.stars.toLocaleString()}</>
                )}
                <ExternalLink size={10} className="ml-1 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          );
        })}
      </div>
    </Card>
  );
}
