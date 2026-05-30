import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAuthorPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { PaperCard } from '../../components/PaperCard';
import { Users } from 'lucide-react';

// ISR: 6h (matches KV TTL)
export const revalidate = 21600;

interface Props {
  params: { name: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = decodeURIComponent(params.name);
  return {
    title: `${name} — arXiv Papers`,
    description: `Browse arXiv papers by ${name} on ArxivExplorer.`,
  };
}

export default async function AuthorPage({ params }: Props) {
  const name = decodeURIComponent(params.name);

  let data: Awaited<ReturnType<typeof getAuthorPapers>>;
  try {
    data = await getAuthorPapers(name);
  } catch {
    notFound();
  }

  const { author, papers } = data;

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">Author</span>
          <span>/</span>
          <span className="text-neon-red/70">{author}</span>
        </nav>

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full border border-neon-red/30 bg-neon-red/5
            flex items-center justify-center flex-shrink-0">
            <Users size={18} className="text-neon-red/50" />
          </div>
          <div>
            <h1 className="text-xl font-mono font-bold text-white/90">{author}</h1>
            <p className="text-xs text-neon-red/40 font-mono mt-0.5">
              {papers.length} indexed paper{papers.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Papers */}
        {papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <p className="text-neon-red/40 font-mono text-sm">No papers indexed for this author.</p>
            <Link href="/" className="mt-2 text-xs text-neon-red/40 hover:text-neon-red font-mono underline">
              ← Back to home
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} showAbstract />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
