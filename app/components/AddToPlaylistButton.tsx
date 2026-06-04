'use client';
// app/components/AddToPlaylistButton.tsx
// Button on paper pages to add/remove paper from playlists.

import { useState, useEffect } from 'react';
import { loadPlaylists, createPlaylist, addToPlaylist, removeFromPlaylist, getPlaylistsForPaper, type Playlist } from '@/lib/playlists';
import { ListMusic, Plus, Check, ChevronDown } from 'lucide-react';

interface Props {
  paperId: string;
  paperTitle: string;
}

export function AddToPlaylistButton({ paperId, paperTitle }: Props) {
  const [open, setOpen]         = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [inPlaylists, setInPlaylists] = useState<Set<string>>(new Set());
  const [newName, setNewName]   = useState('');
  const [creating, setCreating] = useState(false);

  function refresh() {
    const all = loadPlaylists();
    setPlaylists(all);
    setInPlaylists(new Set(getPlaylistsForPaper(paperId).map(p => p.id)));
  }

  useEffect(() => {
    refresh();
    window.addEventListener('arxiv:playlists-changed', refresh);
    return () => window.removeEventListener('arxiv:playlists-changed', refresh);
  }, [paperId]);

  function toggle(pl: Playlist) {
    if (inPlaylists.has(pl.id)) {
      removeFromPlaylist(pl.id, paperId);
    } else {
      addToPlaylist(pl.id, paperId);
    }
    refresh();
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const pl = createPlaylist(newName);
    addToPlaylist(pl.id, paperId);
    setNewName('');
    setCreating(false);
    refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border
          border-neon-red/20 text-neon-red/50 hover:border-neon-red/40
          hover:text-neon-red/80 text-xs font-mono transition-colors"
      >
        <ListMusic size={12} />
        Playlist
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div className="absolute top-full mt-1 right-0 z-20 w-56 bg-[#0f0f0f] border
            border-neon-red/20 rounded-xl shadow-xl overflow-hidden">

            {playlists.length === 0 && !creating && (
              <p className="px-3 py-2 text-[11px] font-mono text-white/30">No playlists yet</p>
            )}

            {playlists.map(pl => (
              <button key={pl.id} onClick={() => toggle(pl)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left
                  hover:bg-white/5 transition-colors group">
                <Check size={11} className={`flex-shrink-0 transition-colors ${inPlaylists.has(pl.id) ? 'text-green-400' : 'text-transparent'}`} />
                <span className="flex-1 text-xs font-mono text-white/70 truncate">{pl.name}</span>
                <span className="text-[9px] font-mono text-white/20">{pl.paperIds.length}</span>
              </button>
            ))}

            <div className="border-t border-neon-red/10">
              {creating ? (
                <form onSubmit={handleCreate} className="flex gap-1 px-2 py-1.5">
                  <input
                    autoFocus
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && setCreating(false)}
                    placeholder="Playlist name…"
                    className="flex-1 bg-transparent text-xs font-mono text-white/80
                      placeholder-white/20 focus:outline-none border-b border-neon-red/30 px-1"
                  />
                  <button type="submit" className="text-neon-red/60 hover:text-neon-red transition-colors">
                    <Check size={12} />
                  </button>
                </form>
              ) : (
                <button onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left
                    hover:bg-white/5 transition-colors text-neon-red/50 hover:text-neon-red/80">
                  <Plus size={11} />
                  <span className="text-xs font-mono">New playlist</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
