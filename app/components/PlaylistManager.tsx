'use client';
// app/components/PlaylistManager.tsx
// Full client-side playlist UI: create, rename, delete, view papers.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  loadPlaylists, createPlaylist, deletePlaylist, renamePlaylist,
  removeFromPlaylist, type Playlist,
} from '@/lib/playlists';
import { ListMusic, Plus, Trash2, Pencil, Check, X, ExternalLink } from 'lucide-react';

export function PlaylistManager() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newName, setNewName]     = useState('');
  const [editing, setEditing]     = useState<string | null>(null);
  const [editName, setEditName]   = useState('');
  const [expanded, setExpanded]   = useState<string | null>(null);

  useEffect(() => {
    setPlaylists(loadPlaylists());
    const sync = () => setPlaylists(loadPlaylists());
    window.addEventListener('arxiv:playlists-changed', sync);
    return () => window.removeEventListener('arxiv:playlists-changed', sync);
  }, []);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createPlaylist(newName);
    setNewName('');
  }

  function handleRename(id: string) {
    renamePlaylist(id, editName);
    setEditing(null);
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this playlist?')) return;
    deletePlaylist(id);
  }

  if (playlists.length === 0) {
    return (
      <div className="space-y-6">
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="New playlist name…"
            className="flex-1 bg-black/40 border border-neon-red/20 rounded-lg px-3 py-2
              text-sm font-mono text-white/80 placeholder-white/20 focus:outline-none
              focus:border-neon-red/50"
          />
          <button type="submit"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border
              border-neon-red/30 text-neon-red/70 hover:border-neon-red/60
              hover:text-neon-red text-xs font-mono transition-colors">
            <Plus size={13} /> Create
          </button>
        </form>
        <p className="text-sm text-white/30 font-mono text-center py-8">
          No playlists yet. Create one to start organising papers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New playlist name…"
          className="flex-1 bg-black/40 border border-neon-red/20 rounded-lg px-3 py-2
            text-sm font-mono text-white/80 placeholder-white/20 focus:outline-none
            focus:border-neon-red/50"
        />
        <button type="submit"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border
            border-neon-red/30 text-neon-red/70 hover:border-neon-red/60
            hover:text-neon-red text-xs font-mono transition-colors">
          <Plus size={13} /> Create
        </button>
      </form>

      {/* Playlist list */}
      {playlists.map(pl => (
        <div key={pl.id}
          className="border border-neon-red/15 rounded-xl overflow-hidden bg-black/30">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-neon-red/10">
            <ListMusic size={14} className="text-neon-red/40 flex-shrink-0" />

            {editing === pl.id ? (
              <input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(pl.id); if (e.key === 'Escape') setEditing(null); }}
                className="flex-1 bg-transparent border-b border-neon-red/40 text-sm
                  font-mono text-white/90 focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setExpanded(expanded === pl.id ? null : pl.id)}
                className="flex-1 text-left text-sm font-mono text-white/80 hover:text-white transition-colors">
                {pl.name}
              </button>
            )}

            <span className="text-[10px] font-mono text-white/25">{pl.paperIds.length} papers</span>

            {editing === pl.id ? (
              <div className="flex gap-1">
                <button onClick={() => handleRename(pl.id)} aria-label="Save"
                  className="p-1 text-green-400/60 hover:text-green-400 transition-colors">
                  <Check size={12} />
                </button>
                <button onClick={() => setEditing(null)} aria-label="Cancel"
                  className="p-1 text-white/30 hover:text-white/60 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="flex gap-1">
                <button onClick={() => { setEditing(pl.id); setEditName(pl.name); }}
                  aria-label="Rename playlist"
                  className="p-1 text-white/20 hover:text-white/50 transition-colors">
                  <Pencil size={12} />
                </button>
                <button onClick={() => handleDelete(pl.id)} aria-label="Delete playlist"
                  className="p-1 text-white/20 hover:text-red-400/70 transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Papers */}
          {expanded === pl.id && (
            <div className="divide-y divide-neon-red/5">
              {pl.paperIds.length === 0 ? (
                <p className="px-4 py-3 text-xs text-white/25 font-mono">
                  No papers yet. Add them from any paper page.
                </p>
              ) : (
                pl.paperIds.map((paperId, i) => (
                  <div key={paperId} className="flex items-center gap-3 px-4 py-2.5 group">
                    <span className="text-[10px] font-mono text-white/20 w-5 text-right">{i + 1}</span>
                    <Link href={`/paper/${paperId}`}
                      className="flex-1 text-xs font-mono text-white/60 hover:text-white transition-colors truncate">
                      {paperId}
                    </Link>
                    <Link href={`/paper/${paperId}`} aria-label="Open paper"
                      className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-white/70 transition-all">
                      <ExternalLink size={11} />
                    </Link>
                    <button
                      onClick={() => removeFromPlaylist(pl.id, paperId)}
                      aria-label="Remove from playlist"
                      className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-red-400/70 transition-all">
                      <X size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
