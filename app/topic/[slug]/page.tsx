import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTopicPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { PaperCard } from '../../components/PaperCard';
import { CategoryBadge } from '../../components/CategoryBadge';
import { CategoryScopeBar } from '../../components/CategoryScopeBar';
import { Database } from 'lucide-react';
import { TOPICS, TOPIC_SLUGS } from '@/lib/topics';
import { TopicActivityTracker } from '../../components/TopicActivityTracker';
import { AchievementToast } from '../../components/AchievementToast';

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
    // Fallback to lib/topics label if the slug is known
    const localTopic = TOPICS.find(t => t.slug === slug);
    if (localTopic) {
      return {
        title: `${localTopic.label} — arXiv Papers`,
        description: `Browse ${localTopic.label} research papers on ArxivExplorer.`,
      };
    }
    console.error('[topic/generateMetadata]', slug, err);
    return { title: 'Topic not found' };
  }
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;

  // Hard 404 only for slugs that are completely unknown (not in lib/topics and not in DB)
  let data: Awaited<ReturnType<typeof getTopicPapers>> | null = null;
  try {
    data = await getTopicPapers(slug);
  } catch (err) {
    console.error('[topic/page]', slug, err);
    // If the slug isn't known in our local topics list either, 404
    if (!TOPIC_SLUGS.has(slug)) {
      notFound();
    }
    // Otherwise fall through: show an empty state for a known topic with no DB entry yet
  }

  // If we got data, use it. Otherwise synthesise a minimal topic shell from lib/topics.
  const localTopic = TOPICS.find(t => t.slug === slug);
  const topic = data?.topic ?? (localTopic
    ? { slug, label: localTopic.label, categoryTags: [localTopic.category], updatedAt: '' }
    : null);

  if (!topic) notFound();

  const papers = data?.papers ?? [];

  return (
    <>
      <Navbar />
      <TopicActivityTracker slug={slug} />
      <AchievementToast />
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

        {/* Scope notice — shows code + full English label from DB */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 mb-6 rounded-lg
          border border-neon-red/15 bg-neon-red/5">
          <Database size={13} className="text-neon-red/40 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] font-mono text-neon-red/45 leading-relaxed">
            Papers sourced from{' '}
            {topic.categoryTags.map((tag, i) => {
              const detail = topic.categoryDetails?.[i];
              return (
                <span key={tag}>
                  <span className="text-neon-red/70 font-semibold">{tag}</span>
                  {detail && (
                    <span className="text-neon-red/40"> · {detail.label}</span>
                  )}
                  {i < topic.categoryTags.length - 1 && <span className="text-neon-red/30">{' · '}</span>}
                </span>
              );
            })}{' '}
            on arXiv. Results are filtered to{' '}
            {topic.categoryTags.length === 1 ? 'this category' : 'these categories'} only.
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
