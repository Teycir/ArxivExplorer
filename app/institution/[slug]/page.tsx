import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getInstitutionPapers } from '@/helper/api';
import { Navbar } from '../../components/Navbar';
import { PaperCard } from '../../components/PaperCard';
import { Building2 } from 'lucide-react';

// ISR: 12h — institution membership changes slowly
export const revalidate = 43200;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const name = decodeURIComponent(rawSlug);
  return {
    title: `${name} — Institution · ArxivExplorer`,
    description: `Browse arXiv papers by authors affiliated with ${name} on ArxivExplorer.`,
  };
}

export default async function InstitutionPage({ params }: Props) {
  const { slug: rawSlug } = await params;
  const name = decodeURIComponent(rawSlug);

  let data: Awaited<ReturnType<typeof getInstitutionPapers>>;
  try {
    data = await getInstitutionPapers(name);
  } catch {
    notFound();
  }

  const { institution, papers } = data;

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        <nav className="flex items-center gap-2 text-xs font-mono text-neon-red/30 mb-6">
          <Link href="/" className="hover:text-neon-red/60 transition-colors">Home</Link>
          <span>/</span>
          <span className="text-neon-red/50">Institution</span>
          <span>/</span>
          <span className="text-neon-red/70">{institution}</span>
        </nav>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full border border-neon-red/30 bg-neon-red/5
            flex items-center justify-center flex-shrink-0">
            <Building2 size={18} className="text-neon-red/50" />
          </div>
          <div>
            <h1 className="text-xl font-mono font-bold text-white/90">{institution}</h1>
            <p className="text-xs text-neon-red/40 font-mono mt-0.5">
              {papers.length} indexed paper{papers.length !== 1 ? 's' : ''} · via OpenAlex affiliations
            </p>
          </div>
        </div>

        {papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <p className="text-neon-red/40 font-mono text-sm">No papers indexed for this institution yet.</p>
            <p className="text-white/25 font-mono text-xs">
              Affiliations are sourced from OpenAlex — run the backfill once enrichment data is available.
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
