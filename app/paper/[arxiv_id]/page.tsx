import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPaper, getRelatedPapers, getPaperCode, getPaperBenchmarks } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { CategoryBadge } from '../../components/CategoryBadge';
import { Card } from '../../components/Card';
import { SummarySection } from '../../components/SummarySection';
import { RelatedPapersList } from '../../components/RelatedPapersList';
import { CodeSection } from '../../components/CodeSection';
import { BenchmarkSection } from '../../components/BenchmarkSection';
import { ConceptBrowser } from '../../components/ConceptBrowser';
import { formatDate } from '@/helper/format';
import type { PaperWithSummary, RelatedPaper, PaperCode, PaperBenchmark } from '@/src/shared/types';
import { ExternalLink, FileText, Users, Calendar, Lock, Building2 } from 'lucide-react';
import { BookmarkButton } from '../../components/BookmarkButton';
import { ExportButton } from '../../components/ExportButton';
import { ShareButton } from '../../components/ShareButton';
import { AuthorLinks } from '../../components/AuthorLinks';

interface Props {
  params: Promise<{ arxiv_id: string }>;
}

// Force dynamic — never ISR-cache this page.
// The API worker (KV) already handles caching at the data layer.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { arxiv_id } = await params;
  try {
    const paper = await getPaper(decodeURIComponent(arxiv_id));
    return {
      title: paper.title,
      description: paper.summary?.tldr ?? paper.abstract.slice(0, 160),
      openGraph: {
        title: paper.title,
        description: paper.summary?.tldr ?? paper.abstract.slice(0, 160),
        type: 'article',
      },
    };
  } catch {
    return { title: 'Paper not found' };
  }
}

async function fetchPaperData(arxivId: string): Promise<{
  paper: PaperWithSummary;
  related: RelatedPaper[];
  repos: PaperCode[];
  benchmarks: PaperBenchmark[];
}> {
  const [paper, related, repos, benchmarks] = await Promise.allSettled([
    getPaper(arxivId),
    getRelatedPapers(arxivId),
    getPaperCode(arxivId),
    getPaperBenchmarks(arxivId),
  ]);

  if (paper.status === 'rejected') throw new Error('Paper not found');

  return {
    paper: paper.value,
    related:    related.status    === 'fulfilled' ? related.value    : [],
    repos:      repos.status      === 'fulfilled' ? repos.value      : [],
    benchmarks: benchmarks.status === 'fulfilled' ? benchmarks.value : [],
  };
}

export default async function PaperPage({ params }: Props) {
  const { arxiv_id } = await params;
  const arxivId = decodeURIComponent(arxiv_id);

  let paper: PaperWithSummary;
  let related: RelatedPaper[];
  let repos: PaperCode[];
  let benchmarks: PaperBenchmark[];

  try {
    ({ paper, related, repos, benchmarks } = await fetchPaperData(arxivId));
  } catch {
    notFound();
  }

  // Build institution map: author name → institution
  const affiliationMap = new Map<string, string>();
  for (const a of paper.affiliations ?? []) {
    if (a.author && a.institution) affiliationMap.set(a.author, a.institution);
  }

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">{arxivId}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* ── Left: paper content ─────────────────────────────── */}
          <div className="flex flex-col gap-6 min-w-0">

            {/* Metadata card */}
            <Card>
              {/* Categories */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {paper.categories.map((cat) => (
                  <CategoryBadge key={cat} category={cat} />
                ))}
                {/* Open access badge */}
                {paper.isOpenAccess && (
                  <a
                    href={paper.oaUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
                      border border-sky-500/40 bg-sky-500/10 text-sky-400
                      hover:border-sky-500/70 hover:text-sky-300 transition-colors"
                  >
                    <Lock size={9} /> Open Access
                  </a>
                )}
              </div>

              {/* Title */}
              <h1 className="text-white/95 font-mono font-bold text-lg leading-snug mb-4">
                {paper.title}
              </h1>

              {/* Authors with affiliations */}
              <div className="flex items-start gap-2 text-xs font-mono mb-3">
                <Users size={13} className="flex-shrink-0 text-neon-red/50 mt-0.5" />
                <div className="leading-relaxed">
                  {paper.authors.map((author, i) => {
                    const institution = affiliationMap.get(author);
                    return (
                      <span key={author} className="inline">
                        <Link
                          href={`/author/${encodeURIComponent(author)}`}
                          className="text-neon-red/60 hover:text-neon-red transition-colors"
                        >
                          {author}
                        </Link>
                        {institution && (
                          <span className="inline-flex items-center gap-0.5 ml-1 text-[10px] text-white/30">
                            <Building2 size={9} />
                            <Link
                              href={`/institution/${encodeURIComponent(institution)}`}
                              className="hover:text-white/60 transition-colors"
                            >
                              {institution}
                            </Link>
                          </span>
                        )}
                        {i < paper.authors.length - 1 && <span className="text-neon-red/20">, </span>}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Date + ID */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-neon-red/30 font-mono mb-5">
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(paper.publishedAt)}
                  {paper.revisedAt && paper.revisedAt !== paper.publishedAt && (
                    <span className="ml-1 text-neon-red/20">(revised {formatDate(paper.revisedAt)})</span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <FileText size={12} />
                  arXiv:{arxivId}
                </span>
                {paper.influentialCitationCount != null && paper.influentialCitationCount > 0 && (
                  <span className="text-amber-400/50">
                    {paper.influentialCitationCount} influential citation{paper.influentialCitationCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <BookmarkButton id={arxivId} title={paper.title} authors={paper.authors} categories={paper.categories} />
                <ShareButton id={arxivId} title={paper.title} tldr={paper.summary?.tldr} />
                <ExportButton id={arxivId} title={paper.title} authors={paper.authors}
                  categories={paper.categories} publishedAt={paper.publishedAt} summary={paper.summary} />
                {paper.pdfUrl && (
                  <a href={paper.pdfUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
                      border border-neon-red/30 text-neon-red/70 rounded-lg
                      hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all">
                    <ExternalLink size={12} /> PDF
                  </a>
                )}
                {paper.htmlUrl && (
                  <a href={paper.htmlUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
                      border border-neon-red/30 text-neon-red/70 rounded-lg
                      hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all">
                    <ExternalLink size={12} /> HTML
                  </a>
                )}
              </div>
            </Card>

            {/* AI Summary + enriched panels */}
            <SummarySection paper={paper} />

            {/* Code repositories */}
            {repos.length > 0 && <CodeSection repos={repos} />}

            {/* Benchmark results */}
            {benchmarks.length > 0 && <BenchmarkSection benchmarks={benchmarks} />}

            {/* Concept browser */}
            {paper.concepts.length > 0 && <ConceptBrowser concepts={paper.concepts} />}

            {/* Abstract */}
            <Card title="Abstract">
              <p className="text-xs text-white/60 leading-relaxed">{paper.abstract}</p>
            </Card>
          </div>

          {/* ── Right: related papers sidebar ───────────────────── */}
          <aside>
            <RelatedPapersList related={related} />
          </aside>
        </div>
      </main>
    </>
  );
}
