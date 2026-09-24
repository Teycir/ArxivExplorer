import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { QuotaNotice } from '../components/QuotaNotice';
import { getStats, getTopics, getTrendingPapers, isOutage, isQuotaExhausted } from '@/helper/api';
import { ExploreClient } from './ExploreClient';

export const metadata: Metadata = {
  title: 'Explore — ArxivCSExplorer',
  description: 'Browse CS research by topic and trending papers.',
};

export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
  const [stats, topicsData, trending] = await Promise.allSettled([
    getStats(),
    getTopics(),
    getTrendingPapers('week'),
  ]);

  // Any leg failing with a typed outage error means the whole page is degraded.
  // A confirmed quota exhaustion outranks a generic outage when legs disagree.
  const outages = [stats, topicsData, trending]
    .map(r => (r.status === 'rejected' ? r.reason : null))
    .filter(isOutage);
  const outage = outages.find(isQuotaExhausted) ?? outages[0];

  if (outage) {
    return (
      <>
        <Navbar />
        <main className="max-w-5xl mx-auto px-4 py-8">
          <QuotaNotice
            variant="full"
            kind={isQuotaExhausted(outage) ? 'quota' : 'unavailable'}
            retryAfter={outage.retryAfter}
          />
        </main>
      </>
    );
  }

  const totalPapers    = stats.status === 'fulfilled' ? (stats.value.totalPapers ?? 0) : 0;
  const allTopics      = topicsData.status === 'fulfilled' ? topicsData.value.topics : [];
  const trendingPapers = trending.status === 'fulfilled' ? trending.value.papers.slice(0, 8) : [];
  // The API serves its last full list when this week is empty/unavailable; the
  // sidebar must not call that "Trending this week".
  const trendingStale  = trending.status === 'fulfilled' && trending.value.stale === true;

  const sortedTopics = [...allTopics].sort((a, b) => b.paperCount - a.paperCount);
  const topTopics    = sortedTopics.slice(0, 5);

  return (
    <>
      <Navbar />
      <ExploreClient
        totalPapers={totalPapers}
        allTopics={allTopics}
        sortedTopics={sortedTopics}
        topTopics={topTopics}
        trendingPapers={trendingPapers}
        trendingStale={trendingStale}
      />
    </>
  );
}
