import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getConceptPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { PaperCard } from '../../components/PaperCard';
import { Layers } from 'lucide-react';

// ISR: 12h — concept membership changes slowly
export const revalidate = 43200;

interface Props {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  return {
    title: `${name} — Concept · ArxivExplorer`,
    description: `Browse arXiv papers tagged with the Wikidata concept "${name}" on ArxivExplorer.`,
  };
}

export default async function ConceptPage({ params }: Props) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  let data: Awaited<ReturnType<typeof getConceptPapers>>;
  try {
    data = await getConceptPapers(name);
  } catch {
    notFound();
  }

  const { concept, papers } = data;

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">Concept</span>
          <span>/</span>
          <span className="text-neon-red/70">{concept}</span>
        </nav>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full border border-neon-red/30 bg-neon-red/5
            flex items-center justify-center flex-shrink-0">
            <Layers size={18} className="text-neon-red/50" />
          </div>
          <div>
            <h1 className="text-xl font-mono font-bold text-white/90">{concept}</h1>
            <p className="text-xs text-neon-red/40 font-mono mt-0.5">
              {papers.length} indexed paper{papers.length !== 1 ? 's' : ''} · Wikidata concept
            </p>
          </div>
        </div>

        {papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <p className="text-neon-red/40 font-mono text-sm">No papers indexed for this concept yet.</p>
            <p className="text-white/25 font-mono text-xs">
              Concepts are sourced from OpenAlex — run the backfill once enrichment data is available.
            </p>
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
