import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '../components/Navbar';
import { Card } from '../components/Card';
import { CategoryScopeBar } from '../components/CategoryScopeBar';
import { Search, FileText, BookOpen, Users, Tag, TrendingUp, Bookmark, Filter, GitCompare, Sparkles, Rss, Trophy, History, Share2, Compass } from 'lucide-react';

export const metadata: Metadata = {
  title: 'How to Use',
  description: 'Learn how to search and explore CS arXiv papers on ArxivCSExplorer.',
};

const STEPS = [
  {
    icon: <Search size={16} />,
    title: 'Hybrid semantic search',
    body: 'Type any research topic, method name, or question. ArxivCSExplorer uses hybrid FTS5 keyword + Vectorize semantic search — so "efficient attention for long sequences" and "linear attention" both surface relevant papers. Results are cached in KV with 2h TTL.',
  },
  {
    icon: <Filter size={16} />,
    title: 'Advanced filtering',
    body: 'Filter results by author (substring match), minimum citation count, arXiv category (cs.LG, cs.CL, etc.), and date range (day/week/month). All filters work together and persist across searches. Example: search="transformer" + author="Vaswani" + minCitations=100.',
  },
  {
    icon: <FileText size={16} />,
    title: 'Direct paper lookup',
    body: 'Paste arXiv ID (e.g. 2312.00752) or full arxiv.org URL into the search box to jump straight to the paper detail page with AI summary, citations, related papers, and export options.',
  },
  {
    icon: <BookOpen size={16} />,
    title: 'AI-generated summaries',
    body: 'Paper pages show pre-generated summaries in tabs: TL;DR, Key Contributions, Methods, Limitations, Beginner explanation, Technical deep-dive, Prerequisites, and Follow-up questions. All generated during ingestion for instant loading.',
  },
  {
    icon: <Sparkles size={16} />,
    title: '"More Like This" semantic search',
    body: 'Click "more like this" button on any paper card to find semantically similar papers using AI embeddings. Uses cosine similarity on 768-dimensional BGE embeddings via Vectorize.',
  },
  {
    icon: <Bookmark size={16} />,
    title: 'Bookmarks with collections',
    body: 'Save papers to bookmarks (client-side, 90-day TTL, 100-paper soft cap). Create named collections to organize bookmarks, add notes, track reading status (unread/reading/done), and export by collection as JSON or BibTeX. No login required.',
  },
  {
    icon: <History size={16} />,
    title: 'Recent searches & history',
    body: 'Your recent searches are stored and displayed on the homepage for quick re-access. Search history is kept in localStorage and can help you pick up where you left off.',
  },
  {
    icon: <Compass size={16} />,
    title: 'Personalized recommendations',
    body: 'Based on your bookmarked papers, the homepage shows "Recommended for you" section with semantically similar papers you haven\'t seen yet. Uses bookmark content to find related research.',
  },
  {
    icon: <Tag size={16} />,
    title: 'Browse by topic',
    body: 'Use topic chips on homepage or visit /explore to jump into curated collections: Large Language Models, Diffusion Models, RAG, Reinforcement Learning, Computer Vision, Cryptography, and 25+ more topics. Each maps to specific arXiv categories.',
  },
  {
    icon: <Users size={16} />,
    title: 'Author pages & statistics',
    body: 'Click any author name to see all their indexed papers, statistics (total papers, average citations, most cited work), and a timeline visualization. Author pages are cached for fast loading.',
  },
  {
    icon: <TrendingUp size={16} />,
    title: 'Trending papers',
    body: 'Homepage and /explore show trending papers from the last 7 days, ranked by recency and citation velocity. Updated every 10 minutes as new papers are ingested. Cached in KV with 60-minute TTL.',
  },
  {
    icon: <GitCompare size={16} />,
    title: 'Side-by-side paper comparison',
    body: 'Use /compare with up to 6 paper IDs (e.g., /compare?ids=id1,id2,id3) to view summaries in a responsive grid. Sections include TL;DR, contributions, methods, limitations, and technical summaries. Perfect for literature reviews. You can also use the "Compare with ID..." input on any paper page to jump directly to a two-paper comparison.',
  },
  {
    icon: <Sparkles size={16} />,
    title: 'Claim classification',
    body: 'Submit a scientific claim (minimum 3 words) at /claim and AI retrieves relevant papers, then classifies each as supporting, contradicting, or neutral. Powered by Llama 3.1 with parallel processing and reasoning explanations.',
  },
  {
    icon: <Share2 size={16} />,
    title: 'Share & export',
    body: 'Share papers via Web Share API or copy link. Export bookmarks and collections as JSON or BibTeX. Copy arXiv IDs and BibTeX citations with one click from paper pages. Copy the abstract directly from the abstract card using the copy icon next to the heading.',
  },
  {
    icon: <Trophy size={16} />,
    title: 'Achievement system',
    body: 'Unlock gamified badges (bronze/silver/gold tiers) for milestones: reading papers, exploring topics, maintaining daily reading streaks, viewing influential papers, code repositories, and benchmarks. Track stats at /achievements.',
  },
  {
    icon: <Rss size={16} />,
    title: 'RSS feed',
    body: 'Subscribe to /rss.xml in your RSS reader to get trending papers from the last week with TL;DR summaries. Feed refreshes hourly and includes new papers as they\'re ingested.',
  },
];

export default function HowToUsePage() {
  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto w-full px-4 py-10 flex-1">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">How to Use</span>
        </nav>

        <h1 className="text-2xl font-mono font-bold text-white/90 mb-1">How to Use</h1>
        <p className="text-sm text-neon-red/40 font-mono mb-10">
          Complete guide to searching, organizing, and exploring research papers with AI-powered features.
        </p>

        <div className="flex flex-col gap-4">
          {STEPS.map(({ icon, title, body }, i) => (
            <Card key={i}>
              <div className="flex items-start gap-4">
                {/* Step number + icon */}
                <div className="flex-shrink-0 flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-lg border border-neon-red/25 bg-neon-red/5
                    flex items-center justify-center text-neon-red/60">
                    {icon}
                  </div>
                  <span className="text-xs font-mono text-neon-red/20">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-mono font-semibold text-white/85 mb-2">{title}</h2>
                  <p className="text-xs text-white/55 leading-relaxed">{body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Indexed Categories */}
        <div className="mt-10">
          <h2 className="text-lg font-mono font-bold text-white/90 mb-4">Indexed Categories</h2>
          <Card>
            <CategoryScopeBar />
          </Card>
        </div>

        {/* CTA */}
        <div className="mt-10 flex gap-4 justify-center">
          <Link
            href="/"
            className="px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider
              border border-neon-red/30 text-neon-red/70 rounded-lg
              hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all"
          >
            ← Start Searching
          </Link>
          <Link
            href="/faq"
            className="px-4 py-2 text-xs font-mono text-neon-red/40 hover:text-neon-red/70 transition-colors"
          >
            Read FAQ
          </Link>
        </div>
      </main>
    </>
  );
}
