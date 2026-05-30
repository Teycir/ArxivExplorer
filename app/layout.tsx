import type { Metadata } from 'next';
import './globals.css';
import { Footer } from './components/Footer';
import { ScrollProgress } from './components/ScrollProgress';

export const metadata: Metadata = {
  metadataBase: new URL('https://arxiv-explorer.pages.dev'),
  title: {
    default: 'ArxivExplorer — Fast semantic arXiv search with AI summaries',
    template: '%s | ArxivExplorer',
  },
  description:
    'Understand any arXiv paper in 60 seconds. Fast semantic search, cached AI summaries, related papers — no login required.',
  keywords: ['arxiv', 'research papers', 'AI summaries', 'semantic search', 'machine learning', 'NLP', 'computer vision'],
  authors: [{ name: 'Teycir Ben Soltane', url: 'https://teycirbensoltane.tn' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://arxiv-explorer.pages.dev',
    siteName: 'ArxivExplorer',
    title: 'ArxivExplorer — Fast semantic arXiv search with AI summaries',
    description: 'Understand any arXiv paper in 60 seconds.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'ArxivExplorer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ArxivExplorer',
    description: 'Fast semantic arXiv search with cached AI summaries.',
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-dark-bg text-white font-mono antialiased min-h-screen flex flex-col">
        <ScrollProgress />
        {/* Subtle background grid */}
        <div className="fixed inset-0 bg-grid pointer-events-none" aria-hidden="true" />
        {/* Radial red glow at top-center */}
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
