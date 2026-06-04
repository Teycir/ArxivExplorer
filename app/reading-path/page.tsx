// app/reading-path/page.tsx
// Find shortest reading path between two papers

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '../components/Navbar';
import { Card } from '../components/Card';
import { MapPin, ArrowRight, Search, Loader2, BookOpen } from 'lucide-react';
import Link from 'next/link';

interface PathNode {
  id: string;
  title: string;
  tldr: string;
}

export default function ReadingPathPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState<PathNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from) setFromId(from);
    if (to) setToId(to);
  }, [searchParams]);

  async function findPath() {
    if (!fromId.trim() || !toId.trim()) {
      setError('Please enter both paper IDs');
      return;
    }

    setLoading(true);
    setError(null);
    setPath(null);

    try {
      const res = await fetch(`/api/reading-path?from=${encodeURIComponent(fromId.trim())}&to=${encodeURIComponent(toId.trim())}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to find path');
        return;
      }

      setPath(data.path);
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto w-full px-4 py-8 flex-1">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={20} className="text-neon-red" />
            <h1 className="text-2xl font-mono font-bold text-white">Reading Path</h1>
          </div>
          <p className="text-sm text-white/50 font-mono">
            Find the shortest path between two papers using prerequisites and related work
          </p>
        </div>

        <Card>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2 uppercase tracking-wider">
                From Paper (arXiv ID)
              </label>
              <input
                type="text"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                placeholder="e.g., 2605.30353"
                className="w-full px-3 py-2 bg-black/30 border border-neon-red/20 rounded-lg
                  text-white/90 text-sm font-mono placeholder:text-white/20
                  focus:border-neon-red/50 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2 uppercase tracking-wider">
                To Paper (arXiv ID)
              </label>
              <input
                type="text"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                placeholder="e.g., 2302.13971"
                className="w-full px-3 py-2 bg-black/30 border border-neon-red/20 rounded-lg
                  text-white/90 text-sm font-mono placeholder:text-white/20
                  focus:border-neon-red/50 focus:outline-none transition-colors"
              />
            </div>

            <button
              onClick={findPath}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3
                bg-neon-red/10 border border-neon-red/30 rounded-lg
                text-neon-red font-mono font-bold uppercase text-sm
                hover:bg-neon-red/20 hover:border-neon-red/50 transition-all
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Finding path...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Find reading path
                </>
              )}
            </button>
          </div>
        </Card>

        {error && (
          <Card>
            <div className="flex items-start gap-2 text-amber-400/70">
              <span className="text-xl">⚠</span>
              <div>
                <p className="font-mono font-bold text-sm mb-1">No path found</p>
                <p className="text-xs text-white/50">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {path && path.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 mb-6 pb-3 border-b border-neon-red/15">
              <BookOpen size={14} className="text-neon-red/60" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/60">
                Reading Path ({path.length} papers)
              </span>
            </div>

            <div className="space-y-4">
              {path.map((node, i) => (
                <div key={node.id}>
                  <Link href={`/paper/${node.id}`}>
                    <div className="p-4 rounded-lg border border-neon-red/15 bg-black/20
                      hover:border-neon-red/40 hover:bg-black/30 transition-all cursor-pointer">
                      <div className="flex items-start gap-3 mb-2">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neon-red/20 border border-neon-red/40
                          flex items-center justify-center text-xs font-mono font-bold text-neon-red">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-mono font-bold text-white/90 mb-1 leading-snug">
                            {node.title}
                          </h3>
                          <p className="text-xs text-white/50 font-mono">{node.id}</p>
                        </div>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed pl-9">
                        {node.tldr}
                      </p>
                    </div>
                  </Link>

                  {i < path.length - 1 && (
                    <div className="flex justify-center py-2">
                      <ArrowRight size={16} className="text-neon-red/30" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-neon-red/15">
              <p className="text-xs text-white/40 font-mono">
                💡 Start with paper 1 and work your way through the list to build up the necessary
                background for understanding paper {path.length}.
              </p>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
