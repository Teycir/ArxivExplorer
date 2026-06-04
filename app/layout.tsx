import type { Metadata } from 'next';
import './globals.css';
import { Footer } from './components/Footer';
import { ScrollProgress } from './components/ScrollProgress';
import { ParticleBackground } from './components/ParticleBackground';

export const metadata: Metadata = {
  metadataBase: new URL('https://arxivexplorer.arxivexplorer.workers.dev'),
  title: {
    default: 'ArxivCSExplorer — Fast semantic CS arXiv search with AI summaries',
    template: '%s | ArxivCSExplorer',
  },
  description:
    'Understand any CS arXiv paper in 60 seconds. Fast semantic search across ML, cryptography, systems, algorithms, and more — no login required.',
  keywords: ['arxiv', 'computer science', 'research papers', 'AI summaries', 'semantic search', 'machine learning', 'cryptography', 'systems'],
  authors: [{ name: 'Teycir Ben Soltane', url: 'https://teycirbensoltane.tn' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://arxivexplorer.arxivexplorer.workers.dev',
    siteName: 'ArxivCSExplorer',
    title: 'ArxivCSExplorer — Fast semantic CS arXiv search with AI summaries',
    description: 'Understand any CS arXiv paper in 60 seconds.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'ArxivCSExplorer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ArxivCSExplorer',
    description: 'Fast semantic CS arXiv search with cached AI summaries.',
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  alternates: {
    types: {
      'application/rss+xml': [{ url: '/rss.xml', title: 'ArxivCSExplorer RSS Feed' }],
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-dark-bg text-white font-mono antialiased min-h-screen flex flex-col">
        <ScrollProgress />
        <ParticleBackground />
        {/* Subtle background grid */}
        <div className="fixed inset-0 bg-grid pointer-events-none" aria-hidden="true" />
        {/* Radial neon glow at top-center (neon-red = #00ff41 in this theme) */}
        <div
          className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center top, rgba(0,255,65,0.07) 0%, transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex-1 flex flex-col">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
