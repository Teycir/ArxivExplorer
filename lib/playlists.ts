/**
 * lib/playlists.ts
 * Client-side localStorage playlist system.
 * A playlist is an ordered list of paper IDs with a name.
 */

const LS_KEY = 'arxiv_playlists';

export interface Playlist {
  id:        string;   // uuid-like: Date.now() + random
  name:      string;
  paperIds:  string[]; // arXiv IDs in order
  createdAt: number;   // unix ms
  updatedAt: number;
}

function readRaw(): Playlist[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeRaw(playlists: Playlist[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(playlists));
    window.dispatchEvent(new CustomEvent('arxiv:playlists-changed'));
  } catch { /* storage full */ }
}

export function loadPlaylists(): Playlist[] {
  return readRaw();
}

export function createPlaylist(name: string): Playlist {
  const playlists = readRaw();
  const playlist: Playlist = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Untitled Playlist',
    paperIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeRaw([...playlists, playlist]);
  return playlist;
}

export function deletePlaylist(id: string): void {
  writeRaw(readRaw().filter(p => p.id !== id));
}

export function renamePlaylist(id: string, name: string): void {
  writeRaw(readRaw().map(p => p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p));
}

export function addToPlaylist(playlistId: string, paperId: string): void {
  writeRaw(readRaw().map(p =>
    p.id === playlistId && !p.paperIds.includes(paperId)
      ? { ...p, paperIds: [...p.paperIds, paperId], updatedAt: Date.now() }
      : p
  ));
}

export function removeFromPlaylist(playlistId: string, paperId: string): void {
  writeRaw(readRaw().map(p =>
    p.id === playlistId
      ? { ...p, paperIds: p.paperIds.filter(id => id !== paperId), updatedAt: Date.now() }
      : p
  ));
}

export function reorderPlaylist(playlistId: string, paperIds: string[]): void {
  writeRaw(readRaw().map(p =>
    p.id === playlistId ? { ...p, paperIds, updatedAt: Date.now() } : p
  ));
}

export function getPlaylistsForPaper(paperId: string): Playlist[] {
  return readRaw().filter(p => p.paperIds.includes(paperId));
}
