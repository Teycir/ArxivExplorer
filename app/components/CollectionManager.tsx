/**
 * app/components/CollectionManager.tsx
 * Manage bookmark collections with export/import
 */
'use client';

import { useState } from 'react';
import { FolderOpen, Download, Upload, Plus } from 'lucide-react';
import {
  getCollections,
  updateCollection,
  loadBookmarks,
  type Bookmark,
} from '@/lib/bookmarks';

interface CollectionManagerProps {
  bookmarkId: string;
  currentCollection?: string | undefined;
  allCollections?: string[];
  onUpdate: (collection: string | undefined) => void;
}

export function CollectionManager({ bookmarkId, currentCollection, onUpdate }: CollectionManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const collections = getCollections();

  function handleSelect(name: string | undefined) {
    updateCollection(bookmarkId, name);
    onUpdate(name);
    setIsOpen(false);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    updateCollection(bookmarkId, newName.trim());
    setNewName('');
    setCreating(false);
    onUpdate(newName.trim());
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-[10px] font-mono text-neutral-600 hover:text-neon-red transition-colors"
        title="Manage collection"
      >
        <FolderOpen size={10} />
        {currentCollection || 'uncategorized'}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-neon-red/20 bg-dark-bg shadow-xl p-2">
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              <button
                onClick={() => handleSelect(undefined)}
                className={`w-full text-left px-2 py-1 text-xs font-mono rounded transition-colors ${
                  !currentCollection
                    ? 'bg-neon-red/10 text-neon-red'
                    : 'text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                uncategorized
              </button>
              {collections.map(name => (
                <button
                  key={name}
                  onClick={() => handleSelect(name)}
                  className={`w-full text-left px-2 py-1 text-xs font-mono rounded transition-colors ${
                    currentCollection === name
                      ? 'bg-neon-red/10 text-neon-red'
                      : 'text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>

            {creating ? (
              <div className="mt-2 pt-2 border-t border-neutral-800 flex gap-1">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                  placeholder="Collection name"
                  autoFocus
                  maxLength={30}
                  className="flex-1 bg-neutral-800 border border-neon-red/20 rounded px-2 py-1 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-neon-red/50"
                />
                <button
                  onClick={handleCreate}
                  className="text-xs font-mono text-green-400 hover:text-green-300 px-2"
                >
                  ✓
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full mt-2 pt-2 border-t border-neutral-800 flex items-center gap-1 px-2 py-1 text-xs font-mono text-neutral-500 hover:text-neon-red transition-colors"
              >
                <Plus size={10} />
                new collection
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function CollectionExport({ bookmarks: propBookmarks }: { bookmarks?: Bookmark[] }) {
  function exportCollection(collectionName?: string) {
    const bookmarks = propBookmarks ?? loadBookmarks().bookmarks;
    const filtered = collectionName
      ? bookmarks.filter(b => b.collection === collectionName)
      : bookmarks;

    const data = {
      collection: collectionName || 'all',
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      bookmarks: filtered,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arxiv-${collectionName || 'all'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportBibTeX(collectionName?: string) {
    const bookmarks = propBookmarks ?? loadBookmarks().bookmarks;
    const filtered = collectionName
      ? bookmarks.filter(b => b.collection === collectionName)
      : bookmarks;

    const bibtex = filtered
      .map(b => {
        const key = b.id.replace('arxiv:', '').replace(/\./g, '_');
        const authors = b.authors.join(' and ');
        const year = new Date(b.savedAt).getFullYear();
        return `@article{${key},
  title={${b.title}},
  author={${authors}},
  journal={arXiv preprint arXiv:${b.id.replace('arxiv:', '')}},
  year={${year}}
}`;
      })
      .join('\n\n');

    const blob = new Blob([bibtex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arxiv-${collectionName || 'all'}.bib`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const collections = getCollections();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-mono text-neutral-600">Export:</span>
      <button
        onClick={() => exportCollection()}
        className="flex items-center gap-1 text-xs font-mono text-neutral-600 hover:text-neon-red border border-neutral-800 hover:border-neon-red/30 rounded px-2 py-1 transition-colors"
      >
        <Download size={10} />
        JSON (all)
      </button>
      <button
        onClick={() => exportBibTeX()}
        className="flex items-center gap-1 text-xs font-mono text-neutral-600 hover:text-neon-red border border-neutral-800 hover:border-neon-red/30 rounded px-2 py-1 transition-colors"
      >
        <Download size={10} />
        BibTeX (all)
      </button>
      {collections.length > 0 && (
        <select
          onChange={e => {
            const val = e.target.value;
            if (val.startsWith('json:')) exportCollection(val.slice(5));
            if (val.startsWith('bib:')) exportBibTeX(val.slice(4));
            e.target.value = '';
          }}
          className="text-xs font-mono bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-neutral-400 hover:border-neon-red/30 transition-colors"
        >
          <option value="">by collection...</option>
          {collections.map(name => (
            <>
              <option key={`json-${name}`} value={`json:${name}`}>
                {name} (JSON)
              </option>
              <option key={`bib-${name}`} value={`bib:${name}`}>
                {name} (BibTeX)
              </option>
            </>
          ))}
        </select>
      )}
    </div>
  );
}
