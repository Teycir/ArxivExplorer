'use client';

import { useState, useEffect } from 'react';
import { Navbar } from '../components/Navbar';
import { Heart, X, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface Paper {
  id: string;
  title: string;
  summary?: { tldr?: string };
  categories: string;
}

export default function SpeedDatingPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [current, setCurrent] = useState(0);
  const [liked, setLiked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeed, setShowFeed] = useState(false);

  useEffect(() => {
    fetch('/api/trending?limit=30')
      .then(r => r.json())
      .then(d => {
        setPapers(d.papers || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handleVote(false);
      if (e.key === 'ArrowRight') handleVote(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, papers, liked]);

  const handleVote = (vote: boolean) => {
    if (vote) setLiked([...liked, papers[current].id]);
    
    if (current + 1 < papers.length) {
      setCurrent(current + 1);
    } else {
      setShowFeed(true);
      const profile = { liked, timestamp: Date.now() };
      localStorage.setItem('arxiv_taste_profile', JSON.stringify(profile));
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="animate-spin text-neon-red" size={32} />
        </div>
      </>
    );
  }

  if (showFeed) {
    return (
      <>
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-12 text-center">
          <Sparkles className="mx-auto mb-4 text-neon-red" size={48} />
          <h1 className="text-2xl font-mono text-white mb-4">Profile Built!</h1>
          <p className="text-sm font-mono text-white/60 mb-8">
            Liked {liked.length}/{papers.length} papers. Your taste profile is saved locally.
          </p>
          <Link
            href="/explore"
            className="inline-block px-6 py-3 bg-neon-red/10 hover:bg-neon-red/20 border border-neon-red/30 rounded text-sm font-mono text-neon-red transition-colors"
          >
            Explore Papers
          </Link>
        </main>
      </>
    );
  }

  const paper = papers[current];
  if (!paper) return null;

  return (
    <>
      <Navbar />
      <main className="max-w-xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-xl font-mono text-white mb-2">Paper Speed Dating</h1>
          <p className="text-xs font-mono text-white/40">
            {current + 1} / {papers.length}
          </p>
        </div>

        <div className="bg-black/40 border border-neon-red/20 rounded-lg p-6 mb-6 min-h-[300px]">
          <h2 className="text-lg font-mono text-white mb-4 line-clamp-3">
            {paper.title}
          </h2>
          {paper.summary?.tldr && (
            <p className="text-sm font-mono text-white/70 leading-relaxed">
              {paper.summary.tldr}
            </p>
          )}
        </div>

        <div className="flex gap-4 justify-center">
          <button
            onClick={() => handleVote(false)}
            className="flex items-center gap-2 px-8 py-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-red-500 transition-colors"
          >
            <X size={24} />
            Pass
          </button>
          <button
            onClick={() => handleVote(true)}
            className="flex items-center gap-2 px-8 py-4 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-lg text-green-500 transition-colors"
          >
            <Heart size={24} />
            Like
          </button>
        </div>

        <p className="text-center text-xs font-mono text-white/30 mt-6">
          Arrow keys: ← Pass · → Like
        </p>
      </main>
    </>
  );
}
