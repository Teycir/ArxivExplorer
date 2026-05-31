import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '../components/Navbar';
import { Card } from '../components/Card';
import { CategoryScopeBar } from '../components/CategoryScopeBar';
import { Search, FileText, BookOpen, Users, Tag, TrendingUp } from 'lucide-react';

export const metadata: Metadata = {
  title: 'How to Use',
  description: 'Learn how to search and explore CS arXiv papers on ArxivCSExplorer.',
};

const STEPS = [
  {
    icon: <Search size={16} />,
    title: 'Search by keyword or concept',
    body: 'Type any CS research topic, method name, acronym, or question into the search box. ArxivCSExplorer uses hybrid semantic + keyword search — so "efficient attention for long sequences" and "linear attention" both surface FlashAttention-style papers. Only CS-scoped queries are accepted.',
  },
  {
    icon: <FileText size={16} />,
    title: 'Paste an arXiv ID or URL',
    body: 'Know the paper you want? Paste its arXiv ID (e.g. 2312.00752) or the full arxiv.org URL directly into the search box to jump straight to its detail page.',
  },
  {
    icon: <BookOpen size={16} />,
    title: 'Read the AI summary',
    body: 'The paper detail page shows a multi-tab AI summary: TL;DR (quick overview), Key Contributions, Methods, Limitations, a Beginner explanation, and a Technical deep-dive. Switch between tabs to match your background.',
  },
  {
    icon: <Tag size={16} />,
    title: 'Browse by topic',
    body: 'Use the topic chips on the homepage to jump into curated categories: LLMs, Diffusion Models, RAG, Reinforcement Learning, Computer Vision, and more. Each topic page shows the most recent indexed papers for that area.',
  },
  {
    icon: <Users size={16} />,
    title: 'Explore an author\'s work',
    body: 'Click any author name on a paper card to see all their indexed papers. Author pages are cached and update every 6 hours.',
  },
  {
    icon: <TrendingUp size={16} />,
    title: 'Discover trending papers',
    body: 'The homepage shows trending papers from the last 7 days, ranked by recency. This list refreshes every 60 minutes as new papers are ingested.',
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
          ArxivCSExplorer is designed to be self-explanatory, but here&rsquo;s a quick guide.
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
