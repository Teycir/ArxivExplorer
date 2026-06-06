import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPaper, getRelatedPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { CategoryBadge } from '../../components/CategoryBadge';
import { Card } from '../../components/Card';
import { SummarySection } from '../../components/SummarySection';
import { RelatedPapersList } from '../../components/RelatedPapersList';
import { PaperLabel } from '../../components/PaperLabel';
import { formatDate } from '@/helper/format';
import type { PaperWithSummary, RelatedPaper } from '@/src/shared/types';
import { ExternalLink, FileText, Users, Calendar, BookOpen, GitCompare } from 'lucide-react';
import { BookmarkButton } from '../../components/BookmarkButton';
import { ExportButton } from '../../components/ExportButton';
import { CopyBibtex } from '../../components/CopyBibtex';
import { CopyId } from '../../components/CopyId';
import { ShareButton } from '../../components/ShareButton';
import { AuthorLinks } from '../../components/AuthorLinks';
import { SkillLadder } from '../../components/SkillLadder';
import { ActivityTracker } from '../../components/ActivityTracker';
import { AchievementToast } from '../../components/AchievementToast';
import { CompareWith } from '../../components/CompareWith';
import { CopyAbstract } from '../../components/CopyAbstract';

interface Props {
  params: Promise<{ arxiv_id: string }>;
}

// Force dynamic — never ISR-cache this page.
// The API worker (KV) already handles caching at the data layer.
export const revalidate = 3600; // 1 hour ISR for paper pages

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

  // Paper type badge (matches PaperCard)
  const PAPER_TYPE_LABELS: Record<string, string> = {
    empirical:   'Empirical',
    theoretical: 'Theoretical',
    survey:      'Survey',
    dataset:     'Dataset',
    position:    'Position',
    tutorial:    'Tutorial',
  };
  const paperType  = paper.summary?.paperType;
  const typeLabel  = paperType && paperType !== 'unknown' ? PAPER_TYPE_LABELS[paperType] : null;

  return (
    <>
      <Navbar />
      
      {/* JSON-LD structured data for AI crawlers and search engines */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ScholarlyArticle',
            headline: paper.title,
            description: paper.summary?.tldr ?? paper.abstract.slice(0, 300),
            abstract: paper.abstract,
            datePublished: paper.publishedAt,
            dateModified: paper.revisedAt ?? paper.publishedAt,
            author: paper.authors.map(name => ({
              '@type': 'Person',
              name: name,
            })),
            keywords: paper.summary?.keywords ?? [],
            url: `https://arxivexplorer.arxivexplorer.workers.dev/paper/${paper.id}`,
            sameAs: `https://arxiv.org/abs/${paper.id}`,
            isAccessibleForFree: true,
            license: 'https://arxiv.org/help/license',
            about: paper.categories.map(cat => ({
              '@type': 'Thing',
              name: cat,
            })),
          }),
        }}
      />
      
      {/* Activity tracking + achievement toasts (client-side, zero cost) */}
      <ActivityTracker
        paperId={arxivId}
        hasCode={(paper.codeCount ?? 0) > 0}
        influentialCitationCount={paper.influentialCitationCount ?? 0}
      />
      <AchievementToast />
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
              {/* Categories + paper-type badge */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {paper.categories.map((cat) => (
                  <CategoryBadge key={cat} category={cat} />
                ))}
                {/* Research type pill — same style as PaperCard */}
                {typeLabel && (
                  <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
                    border border-violet-500/30 bg-violet-500/10 text-violet-400/80">
                    <BookOpen size={9} />
                    {typeLabel}
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-white/95 font-mono font-bold text-lg leading-snug mb-4">
                {paper.title}
              </h1>

              {/* Authors */}
              <div className="flex items-start gap-2 text-xs font-mono mb-3">
                <Users size={13} className="flex-shrink-0 text-neon-red/50 mt-0.5" />
                <div className="leading-relaxed">
                  {paper.authors.map((author, i) => (
                    <span key={author} className="inline">
                      <Link
                        href={`/author/${encodeURIComponent(author)}`}
                        className="text-neon-red/60 hover:text-neon-red transition-colors"
                      >
                        {author}
                      </Link>
                      {i < paper.authors.length - 1 && <span className="text-neon-red/20">, </span>}
                    </span>
                  ))}
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
                  <CopyId id={arxivId} />
                </span>
                {paper.influentialCitationCount != null && paper.influentialCitationCount > 0 && (
                  <span className="text-amber-400/50">
                    {paper.influentialCitationCount} influential citation{paper.influentialCitationCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 mb-3">
                <BookmarkButton id={arxivId} title={paper.title} authors={paper.authors} categories={paper.categories} />
                <ShareButton id={arxivId} title={paper.title} tldr={paper.summary?.tldr} />
                <CopyBibtex id={arxivId} title={paper.title} authors={paper.authors}
                  categories={paper.categories} publishedAt={paper.publishedAt} />
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
                {paper.revisedAt && paper.revisedAt !== paper.publishedAt && (
                  <Link href={`/diff/${arxivId}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase
                      border border-violet-500/30 text-violet-400/70 rounded-lg
                      hover:border-violet-500/60 hover:text-violet-400 hover:bg-violet-500/5 transition-all">
                    <FileText size={12} /> Revisions
                  </Link>
                )}
              </div>

              {/* Quick compare */}
              <CompareWith currentId={arxivId} />
            </Card>

            {/* AI Summary + enriched panels */}
            <SummarySection paper={paper} />

            {/* Skill ladder — only shown when summary has prerequisites */}
            {paper.summary?.prerequisites && paper.summary.prerequisites.length > 0 && (
              <SkillLadder
                paperId={paper.id}
                prerequisites={paper.summary.prerequisites}
                paperTitle={paper.title}
              />
            )}

            {/* Abstract */}
            <Card>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-neon-red/20">
                <h3 className="text-neon-red font-mono font-bold uppercase tracking-wider flex items-center gap-2">
                  Abstract
                  <CopyAbstract text={paper.abstract} />
                </h3>
                <Link
                  href={`/search?like=${arxivId}`}
                  className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono
                    border border-neon-red/20 text-neon-red/50 rounded
                    hover:border-neon-red/50 hover:text-neon-red transition-all"
                >
                  <GitCompare size={10} />
                  More Like This
                </Link>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">{paper.abstract}</p>
              
              {/* Citation context link */}
              {paper.citationCount != null && paper.citationCount > 0 && (
                <div className="mt-4 pt-3 border-t border-neon-red/10">
                  <a
                    href={`https://www.semanticscholar.org/paper/${arxivId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[10px] font-mono text-neon-red/40
                      hover:text-neon-red/70 transition-colors"
                  >
                    <ExternalLink size={9} />
                    View {paper.citationCount} citation{paper.citationCount !== 1 ? 's' : ''} on Semantic Scholar
                  </a>
                </div>
              )}
            </Card>
          </div>

          {/* ── Right: related papers sidebar ───────────────────── */}
          <aside className="flex flex-col gap-6">
            <PaperLabel paper={paper} />
            <RelatedPapersList related={related} />
          </aside>
        </div>
      </main>
    </>
  );
}
