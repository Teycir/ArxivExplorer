/**
 * app/components/PaperComparison.tsx
 * Side-by-side comparison of papers
 */
'use client';

import Link from 'next/link';
import { FileText, Users, Tag, ExternalLink } from 'lucide-react';
import { formatAuthors } from '@/helper/format';

interface Summary {
  tldr: string;
  keyContributions: string[];
  methods: string[];
  limitations: string[];
  technicalSummary: string;
}

interface PaperWithSummary {
  id: string;
  title: string;
  authors: string[];
  categories: string[];
  publishedAt: string;
  pdfUrl: string;
  summary: Summary | null;
}

interface PaperComparisonProps {
  papers: PaperWithSummary[];
}

export function PaperComparison({ papers }: PaperComparisonProps) {
  if (papers.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500 font-mono text-sm">No papers to compare</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header comparison */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${papers.length}, minmax(0, 1fr))` }}>
        {papers.map(paper => (
          <div key={paper.id} className="border border-neon-red/20 rounded-lg p-4 bg-dark-bg">
            <Link
              href={`/paper/${encodeURIComponent(paper.id)}`}
              className="text-sm font-mono text-white hover:text-neon-red transition-colors block mb-3"
            >
              {paper.title}
            </Link>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-start gap-1 text-neon-red/40">
                <Users size={10} className="mt-0.5 shrink-0" />
                <span>{formatAuthors(paper.authors, 3)}</span>
              </div>
              <div className="flex items-start gap-1 text-neon-red/30">
                <Tag size={10} className="mt-0.5 shrink-0" />
                <span>{paper.categories.slice(0, 3).join(', ')}</span>
              </div>
              <div className="flex items-center gap-2 text-neon-red/25">
                <span>{new Date(paper.publishedAt).toLocaleDateString()}</span>
                <a
                  href={paper.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-neon-red transition-colors"
                >
                  <ExternalLink size={10} />
                  PDF
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* TL;DR comparison */}
      <ComparisonSection title="TL;DR" papers={papers} field="tldr" />

      {/* Key Contributions */}
      <ComparisonSection title="Key Contributions" papers={papers} field="keyContributions" isList />

      {/* Methods */}
      <ComparisonSection title="Methods" papers={papers} field="methods" isList />

      {/* Limitations */}
      <ComparisonSection title="Limitations" papers={papers} field="limitations" isList />

      {/* Technical Summary */}
      <ComparisonSection title="Technical Summary" papers={papers} field="technicalSummary" />
    </div>
  );
}

interface ComparisonSectionProps {
  title: string;
  papers: PaperWithSummary[];
  field: keyof NonNullable<PaperWithSummary['summary']>;
  isList?: boolean;
}

function ComparisonSection({ title, papers, field, isList }: ComparisonSectionProps) {
  return (
    <div>
      <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/50 mb-3">
        {title}
      </h2>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${papers.length}, minmax(0, 1fr))` }}>
        {papers.map(paper => {
          const summary = paper.summary;
          if (!summary) {
            return (
              <div key={paper.id} className="border border-neon-red/10 rounded-lg p-4 bg-dark-bg">
                <p className="text-xs text-neutral-600 font-mono italic">No summary available</p>
              </div>
            );
          }

          const content = summary[field];
          
          return (
            <div key={paper.id} className="border border-neon-red/10 rounded-lg p-4 bg-dark-bg">
              {isList && Array.isArray(content) ? (
                <ul className="space-y-2">
                  {content.map((item, idx) => (
                    <li key={idx} className="text-xs text-neutral-300 font-mono flex gap-2">
                      <span className="text-neon-red/40 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-300 font-mono leading-relaxed">
                  {String(content)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
