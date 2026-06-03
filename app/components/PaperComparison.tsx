/**
 * app/components/PaperComparison.tsx
 * Roadmap Phase 4 enhancement:
 *   - Up to 6 papers side-by-side (was 4)
 *   - Field selector: choose which sections to compare
 *   - CSV and Markdown export
 *
 * POLICY: Only render links (PDF, HTML) that are stored in the DB.
 * Never synthesise arxiv.org URLs from a bare paper ID.
 */
'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { FileText, Users, Tag, ExternalLink, Download, Table, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { formatAuthors } from '@/helper/format';

interface Summary {
  tldr: string;
  keyContributions: string[];
  methods: string[];
  limitations: string[];
  technicalSummary: string;
  novelty?: string;
  applications?: string[];
}

interface PaperWithSummary {
  id: string;
  title: string;
  authors: string[];
  categories: string[];
  publishedAt: string;
  pdfUrl: string | null;
  htmlUrl?: string | null;
  summary: Summary | null;
  influentialCitationCount?: number;
  codeCount?: number;
  hasBenchmark?: boolean;
}

interface PaperComparisonProps {
  papers: PaperWithSummary[];
}

type FieldKey = 'tldr' | 'keyContributions' | 'methods' | 'limitations' | 'technicalSummary' | 'novelty' | 'applications';

const ALL_FIELDS: Array<{ key: FieldKey; label: string; isList?: boolean }> = [
  { key: 'tldr',             label: 'TL;DR' },
  { key: 'keyContributions', label: 'Key Contributions', isList: true },
  { key: 'methods',          label: 'Methods',           isList: true },
  { key: 'limitations',      label: 'Limitations',       isList: true },
  { key: 'technicalSummary', label: 'Technical Summary' },
  { key: 'novelty',          label: 'Novelty' },
  { key: 'applications',     label: 'Applications',      isList: true },
];

function getFieldValue(summary: Summary, key: FieldKey): string | string[] | undefined {
  switch (key) {
    case 'tldr':             return summary.tldr;
    case 'keyContributions': return summary.keyContributions;
    case 'methods':          return summary.methods;
    case 'limitations':      return summary.limitations;
    case 'technicalSummary': return summary.technicalSummary;
    case 'novelty':          return summary.novelty;
    case 'applications':     return summary.applications;
  }
}

function toText(value: string | string[] | undefined): string {
  if (!value) return '';
  if (Array.isArray(value)) return value.join('; ');
  return value;
}

function exportCsv(papers: PaperWithSummary[], activeFields: Set<FieldKey>) {
  const fields = ALL_FIELDS.filter(f => activeFields.has(f.key));
  const header = ['Title', 'Authors', 'Date', 'Categories', ...fields.map(f => f.label)];
  const rows = papers.map(p => [
    `"${p.title.replace(/"/g, '""')}"`,
    `"${p.authors.join(', ').replace(/"/g, '""')}"`,
    p.publishedAt.slice(0, 10),
    `"${p.categories.join(', ')}"`,
    ...fields.map(f => {
      const val = p.summary ? toText(getFieldValue(p.summary, f.key)) : '';
      return `"${val.replace(/"/g, '""')}"`;
    }),
  ]);
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  download(csv, 'paper-comparison.csv', 'text/csv');
}

function exportMarkdown(papers: PaperWithSummary[], activeFields: Set<FieldKey>) {
  const fields = ALL_FIELDS.filter(f => activeFields.has(f.key));
  const lines: string[] = ['# Paper Comparison\n'];
  for (const f of fields) {
    lines.push(`## ${f.label}\n`);
    const cols = ['Field', ...papers.map(p => p.title.slice(0, 40))];
    lines.push(`| ${cols.join(' | ')} |`);
    lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
    const vals = papers.map(p => (p.summary ? toText(getFieldValue(p.summary, f.key)) : '—').replace(/\|/g, '\\|'));
    lines.push(`| ${f.label} | ${vals.join(' | ')} |`);
    lines.push('');
  }
  download(lines.join('\n'), 'paper-comparison.md', 'text/markdown');
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function PaperComparison({ papers }: PaperComparisonProps) {
  const [activeFields, setActiveFields] = useState<Set<FieldKey>>(
    new Set(['tldr', 'keyContributions', 'methods', 'limitations', 'technicalSummary'])
  );
  const [showFieldPicker, setShowFieldPicker] = useState(false);

  const toggleField = useCallback((key: FieldKey) => {
    setActiveFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }, []);

  const visibleFields = ALL_FIELDS.filter(f => activeFields.has(f.key));
  const cols = papers.length;
  const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };

  if (papers.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500 font-mono text-sm">No papers to compare</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Field selector */}
        <div className="relative">
          <button
            onClick={() => setShowFieldPicker(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-neon-red/25
              text-neon-red/60 rounded-lg hover:border-neon-red/50 hover:text-neon-red transition-all"
          >
            <Table size={12} />
            Fields ({activeFields.size}/{ALL_FIELDS.length})
            {showFieldPicker ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showFieldPicker && (
            <div className="absolute top-8 left-0 z-20 bg-[#0d0d0d] border border-neon-red/20
              rounded-xl shadow-xl p-3 flex flex-col gap-1.5 min-w-[160px]">
              {ALL_FIELDS.map(f => (
                <button
                  key={f.key}
                  onClick={() => toggleField(f.key)}
                  className="flex items-center gap-2 px-2 py-1 text-[11px] font-mono text-left
                    rounded hover:bg-neon-red/10 transition-colors"
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0
                    ${activeFields.has(f.key) ? 'border-neon-red bg-neon-red/20' : 'border-neon-red/30'}`}>
                    {activeFields.has(f.key) && <Check size={9} className="text-neon-red" />}
                  </span>
                  <span className={activeFields.has(f.key) ? 'text-white/80' : 'text-white/40'}>
                    {f.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Export buttons */}
        <button
          onClick={() => exportCsv(papers, activeFields)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-neon-red/20
            text-neon-red/50 rounded-lg hover:border-neon-red/40 hover:text-neon-red/80 transition-all"
        >
          <Download size={11} /> CSV
        </button>
        <button
          onClick={() => exportMarkdown(papers, activeFields)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-neon-red/20
            text-neon-red/50 rounded-lg hover:border-neon-red/40 hover:text-neon-red/80 transition-all"
        >
          <Download size={11} /> Markdown
        </button>
      </div>

      {/* ── Header row ───────────────────────────────────────────────── */}
      <div className="grid gap-3" style={gridStyle}>
        {papers.map(paper => (
          <div key={paper.id} className="border border-neon-red/20 rounded-lg p-4 bg-dark-bg">
            <Link
              href={`/paper/${encodeURIComponent(paper.id)}`}
              className="text-sm font-mono text-white hover:text-neon-red transition-colors block mb-3 leading-snug"
            >
              {paper.title}
            </Link>
            <div className="space-y-1.5 text-xs font-mono">
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
                {paper.pdfUrl && (
                  <a href={paper.pdfUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-neon-red transition-colors">
                    <ExternalLink size={10} /> PDF
                  </a>
                )}
              </div>
              {/* Quick quality signals */}
              <div className="flex flex-wrap gap-1 pt-1">
                {(paper.influentialCitationCount ?? 0) >= 50 && (
                  <span className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-amber-500/30 text-amber-400/70 bg-amber-500/10">
                    Influential
                  </span>
                )}
                {(paper.codeCount ?? 0) > 0 && (
                  <span className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-emerald-500/30 text-emerald-400/70 bg-emerald-500/10">
                    Code
                  </span>
                )}
                {paper.hasBenchmark && (
                  <span className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-purple-500/30 text-purple-400/70 bg-purple-500/10">
                    Benchmarked
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Comparison sections ───────────────────────────────────────── */}
      {visibleFields.map(field => (
        <ComparisonSection key={field.key} title={field.label} papers={papers} fieldKey={field.key} isList={field.isList} />
      ))}
    </div>
  );
}

interface ComparisonSectionProps {
  title: string;
  papers: PaperWithSummary[];
  fieldKey: FieldKey;
  isList?: boolean;
}

function ComparisonSection({ title, papers, fieldKey, isList }: ComparisonSectionProps) {
  const cols = papers.length;
  return (
    <div>
      <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/50 mb-3">
        {title}
      </h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {papers.map(paper => {
          const summary = paper.summary;
          if (!summary) {
            return (
              <div key={paper.id} className="border border-neon-red/10 rounded-lg p-4 bg-dark-bg">
                <p className="text-xs text-neutral-600 font-mono italic">No summary</p>
              </div>
            );
          }
          const content = getFieldValue(summary, fieldKey);
          if (!content || (Array.isArray(content) && content.length === 0)) {
            return (
              <div key={paper.id} className="border border-neon-red/10 rounded-lg p-4 bg-dark-bg">
                <p className="text-xs text-neutral-700 font-mono italic">—</p>
              </div>
            );
          }
          return (
            <div key={paper.id} className="border border-neon-red/10 rounded-lg p-4 bg-dark-bg">
              {isList && Array.isArray(content) ? (
                <ul className="space-y-1.5">
                  {content.map((item, idx) => (
                    <li key={idx} className="text-xs text-neutral-300 font-mono flex gap-2">
                      <span className="text-neon-red/40 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-300 font-mono leading-relaxed">
                  {Array.isArray(content) ? content.join(', ') : content}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
