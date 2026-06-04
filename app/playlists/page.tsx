// app/playlists/page.tsx
import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { PlaylistManager } from '../components/PlaylistManager';
import { ListMusic } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Playlists — ArXiv Explorer',
  description: 'Organise papers into ordered playlists, stored in your browser.',
  robots: { index: false },
};

export default function PlaylistsPage() {
  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto w-full px-4 py-10 flex-1">
        <div className="flex items-center gap-3 mb-8">
          <ListMusic size={20} className="text-neon-red/60" />
          <h1 className="text-white/90 font-mono font-bold text-xl tracking-wide">Playlists</h1>
          <span className="text-xs text-neon-red/30 font-mono ml-auto">stored in your browser</span>
        </div>
        <PlaylistManager />
      </main>
    </>
  );
}
