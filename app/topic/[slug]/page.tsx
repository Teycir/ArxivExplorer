import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTopicPapers, isOutage, isQuotaExhausted } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { QuotaNotice } from '../../components/QuotaNotice';
import { PaperCard } from '../../components/PaperCard';

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
    // An outage is not a missing topic: titling the page "Topic not found" while
    // the body says "quota exhausted" gets the wrong title indexed for every topic.
    // Keep the URL's own name, and keep the page out of the index until it can
    // render real content again.
    if (isOutage(err)) {
      return {
        title: `${slug.replace(/-/g, ' ')} — temporarily unavailable`,
        robots: { index: false, follow: true },
      };
    }
    console.error('[topic/generateMetadata]', slug, err);
    return { title: 'Topic not found' };
  }
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;

  // DB is the sole source of truth — unknown slug = 404
  let data: Awaited<ReturnType<typeof getTopicPapers>> | null = null;
  try {
    data = await getTopicPapers(slug);
  } catch (err) {
    // An outage (quota, rate limit, 5xx, network) is NOT a missing topic. Calling
    // notFound() here would serve a real 404 for every /topic/* URL and get them
    // de-indexed by crawlers — including the crawler that got rate-limited.
    if (isOutage(err)) {
      return (
        <>
          <Navbar />
          <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
            <QuotaNotice
              variant="full"
              kind={isQuotaExhausted(err) ? 'quota' : 'unavailable'}
              retryAfter={err.retryAfter}
            />
          </main>
        </>
      );
    }
    console.error('[topic/page]', slug, err);
    notFound();
  }

  const topic = data?.topic ?? null;
  if (!topic) notFound();

  const papers = data?.papers ?? [];

  // Belt-and-suspenders: if the API somehow returned a topic with no papers,
  // treat it as not-found rather than rendering an empty page.
  if (papers.length === 0) notFound();

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
          {/* Category tags */}
          {topic.categoryDetails && topic.categoryDetails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {topic.categoryDetails.map(cat => (
                <span
                  key={cat.code}
                  title={cat.label}
                  className="px-2 py-0.5 rounded text-[10px] font-mono
                    bg-white/[0.04] text-white/40 border border-white/[0.08]"
                >
                  {cat.code}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <p className="text-xs font-mono text-neon-red/30 mb-5">
          {papers.length} paper{papers.length !== 1 ? 's' : ''} indexed
        </p>

        {/* Papers grid */}
        <div className="grid gap-4">
          {papers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      </main>
    </>
  );
}
