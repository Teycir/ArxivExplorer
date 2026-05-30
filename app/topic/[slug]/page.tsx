import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTopicPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { PaperCard } from '../../components/PaperCard';
import { CategoryBadge } from '../../components/CategoryBadge';
import { CategoryScopeBar } from '../../components/CategoryScopeBar';
import { Database } from 'lucide-react';

// ISR: 12h (matches KV TTL)
export const revalidate = 43200;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { topic } = await getTopicPapers(slug);
    return {
      title: `${topic.label} — arXiv Papers`,
      description: topic.description ?? `Browse ${topic.label} research papers on ArxivExplorer.`,
    };
  } catch (err) {
    console.error('[topic/generateMetadata]', slug, err);
    return { title: 'Topic not found' };
  }
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof getTopicPapers>>;
  try {
    data = await getTopicPapers(slug);
  } catch (err) {
    console.error('[topic/page]', slug, err);
    notFound();
  }

  const { topic, papers } = data;

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">{topic.label}</span>
        </nav>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-mono font-bold text-white/90 mb-2">{topic.label}</h1>
          {topic.description && (
            <p className="text-sm text-neon-red/45 font-mono max-w-2xl">{topic.description}</p>
          )}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {topic.categoryTags.map((cat) => (
              <CategoryBadge key={cat} category={cat} />
            ))}
          </div>
        </div>

        {/* Scope notice — makes the data source explicit */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 mb-6 rounded-lg
          border border-neon-red/15 bg-neon-red/5">
          <Database size={13} className="text-neon-red/40 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] font-mono text-neon-red/45 leading-relaxed">
            Papers sourced exclusively from{' '}
            <span className="text-neon-red/70 font-semibold">cs.AI</span> and{' '}
            <span className="text-neon-red/70 font-semibold">cs.LG</span> on arXiv.
            Results within this topic are filtered to those two categories only.
          </p>
        </div>

        {/* Stats */}
        <p className="text-xs font-mono text-neon-red/30 mb-5">
          {papers.length} paper{papers.length !== 1 ? 's' : ''} indexed
        </p>

        {/* Papers grid */}
        {papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <p className="text-neon-red/40 font-mono text-sm">No papers indexed yet for this topic.</p>
            <p className="text-white/25 font-mono text-xs">Check back once the ingestion pipeline has run.</p>
            <CategoryScopeBar />
            <Link href="/" className="mt-2 text-xs text-neon-red/40 hover:text-neon-red font-mono underline">
              ← Back to home
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
