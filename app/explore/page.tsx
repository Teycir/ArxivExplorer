import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { getStats, getTopics, getTrendingPapers } from '@/helper/api';
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

  const totalPapers    = stats.status === 'fulfilled' ? (stats.value.totalPapers ?? 0) : 0;
  const allTopics      = topicsData.status === 'fulfilled' ? topicsData.value.topics : [];
  const trendingPapers = trending.status === 'fulfilled' ? trending.value.papers.slice(0, 8) : [];

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
      />
    </>
  );
}
