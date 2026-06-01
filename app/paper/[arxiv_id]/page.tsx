import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPaper, getRelatedPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { CategoryBadge } from '../../components/CategoryBadge';
import { Card } from '../../components/Card';
import { SummarySection } from '../../components/SummarySection';
import { RelatedPapersList } from '../../components/RelatedPapersList';
import { formatDate, arxivAbsUrl, arxivPdfUrl } from '@/helper/format';
import type { PaperWithSummary, RelatedPaper } from '@/src/shared/types';
import { ExternalLink, FileText, Users, Calendar } from 'lucide-react';
import { BookmarkButton } from '../../components/BookmarkButton';
import { ExportButton } from '../../components/ExportButton';
import { ShareButton } from '../../components/ShareButton';
import { AuthorLinks } from '../../components/AuthorLinks';

interface Props {
  params: Promise<{ arxiv_id: string }>;
}

// ISR: revalidate every hour so pending summaries surface without a redeploy
export const revalidate = 3600;

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
}> {
  const [paper, related] = await Promise.allSettled([
    getPaper(arxivId),
    getRelatedPapers(arxivId),
  ]);

  if (paper.status === 'rejected') throw new Error('Paper not found');

  return {
    paper: paper.value,
    related: related.status === 'fulfilled' ? related.value : [],
  };
}

export default async function PaperPage({ params }: Props) {
  const { arxiv_id } = await params;
  const arxivId = decodeURIComponent(arxiv_id);

  let paper: PaperWithSummary;
  let related: RelatedPaper[];

  try {
    ({ paper, related } = await fetchPaperData(arxivId));
  } catch {
    notFound();
  }

  const absUrl = arxivAbsUrl(arxivId);
  const pdfUrl = paper.pdfUrl ?? arxivPdfUrl(arxivId);

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
              </div>

              {/* Title */}
              <h1 className="text-white/95 font-mono font-bold text-lg leading-snug mb-4">
                {paper.title}
              </h1>

              {/* Authors — each name links to the author page */}
              <div className="flex items-start gap-2 text-xs text-neon-red/50 font-mono mb-3">
                <Users size={13} className="flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <AuthorLinks authors={paper.authors} max={10} />
                </span>
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
              </div>

              {/* Action links */}
              <div className="flex flex-wrap gap-2">
                <BookmarkButton
                  id={arxivId}
                  title={paper.title}
                  authors={paper.authors}
                  categories={paper.categories}
                />
                <ShareButton
                  id={arxivId}
                  title={paper.title}
                  tldr={paper.summary?.tldr}
                />
                <ExportButton
                  id={arxivId}
                  title={paper.title}
                  authors={paper.authors}
                  categories={paper.categories}
                  publishedAt={paper.publishedAt}
                  summary={paper.summary}
                />
                <a
                  href={absUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
                    border border-neon-red/30 text-neon-red/70 rounded-lg
                    hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all"
                >
                  <ExternalLink size={12} /> Abstract
                </a>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
                    border border-neon-red/30 text-neon-red/70 rounded-lg
                    hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all"
                >
                  <ExternalLink size={12} /> PDF
                </a>
                {paper.htmlUrl && (
                  <a
                    href={paper.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
                      border border-neon-red/30 text-neon-red/70 rounded-lg
                      hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all"
                  >
                    <ExternalLink size={12} /> HTML
                  </a>
                )}
              </div>
            </Card>

            {/* AI Summary */}
            <SummarySection paper={paper} />

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
