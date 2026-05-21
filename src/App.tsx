import { useState, useMemo, useEffect, useCallback, lazy, Suspense, useTransition } from 'react';
import { Sidebar } from './components/Sidebar';
import { SearchBar } from './components/SearchBar';
import { BookmarkList } from './components/BookmarkList';
import { FolderView } from './components/FolderView';
import { SidebarSkeleton, SearchBarSkeleton, BookmarkListSkeleton, ModalSkeleton } from './components/Skeletons';
import { COLLECTION } from './types';
import type { Bookmark, Collection, CollectionColor, CollectionIcon, AppState, Message } from './types';
import { buildDescendantsMap } from './utils';
import { useDebouncedValue, useToastQueue } from './hooks';

const AddBookmarkModal = lazy(() => import('./components/AddBookmarkModal').then(m => ({ default: m.AddBookmarkModal })));
const CollectionModal = lazy(() => import('./components/CollectionModal').then(m => ({ default: m.CollectionModal })));

// Custom Hook to manage extension state
function useExtensionState() {
  const [state, setState] = useState<AppState>({ bookmarks: [], collections: [] });
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'BM:getState' } satisfies Message, (response) => {
      if (response && !response.error) {
        setState(response);
        setIsLoaded(true);
      } else {
        setIsLoaded(true);
        console.error("Failed to load state", response?.error);
      }
    });
  }, []);

  const send = useCallback((msg: Message): Promise<AppState> => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        if (response && !response.error) {
          setState(response);
          resolve(response);
          return;
        }
        reject(new Error('No response from background service'));
      });
    });
  }, []);

  return { state, send, isLoaded };
}

function App() {
  const { state, send, isLoaded } = useExtensionState();
  const [activeCollection, setActiveCollection] = useState<string>(COLLECTION.ALL);
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 120);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'a-z' | 'z-a'>('newest');

  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'masonry' | 'folder'>(() => {
    return (localStorage.getItem('bm_viewMode') as 'grid' | 'list' | 'masonry' | 'folder') || 'grid';
  });

  const isDashboard = new URLSearchParams(window.location.search).get('target') === 'dashboard';

  const handleViewModeChange = useCallback((mode: 'grid' | 'list' | 'masonry' | 'folder') => {
    setViewMode(mode);
    localStorage.setItem('bm_viewMode', mode);
  }, []);

  const [bookmarkColumns, setBookmarkColumns] = useState<1 | 2 | 3 | 4 | 5>(() => {
    const saved = localStorage.getItem('bm_bookmarkColumns');
    return (saved ? parseInt(saved, 10) : 1) as 1 | 2 | 3 | 4 | 5;
  });

  const handleBookmarkColumnsChange = useCallback((c: 1 | 2 | 3 | 4 | 5) => {
    setBookmarkColumns(c);
    localStorage.setItem('bm_bookmarkColumns', String(c));
  }, []);

  const [collectionColumns, setCollectionColumns] = useState<1 | 2 | 3 | 4 | 5>(() => {
    const saved = localStorage.getItem('bm_collectionColumns');
    return (saved ? parseInt(saved, 10) : 3) as 1 | 2 | 3 | 4 | 5;
  });

  const handleCollectionColumnsChange = useCallback((c: 1 | 2 | 3 | 4 | 5) => {
    setCollectionColumns(c);
    localStorage.setItem('bm_collectionColumns', String(c));
  }, []);

  // Auto-fallback to grid if leaving All Bookmarks while in folder view
  // or if in popup mode (folder view is dashboard-only)
  useEffect(() => {
    if (viewMode === 'folder' && (activeCollection !== COLLECTION.ALL || !isDashboard)) {
      handleViewModeChange('grid');
    }
  }, [activeCollection, viewMode, handleViewModeChange, isDashboard]);

  const [modal, setModal] = useState<{
    type: 'add' | 'collection' | 'none';
    initial?: Partial<Bookmark>;
    existing?: Collection;
  }>({ type: 'none' });

  const { toasts, show: showToast, dismiss: dismissToast } = useToastQueue();

  const [currentTabBookmark, setCurrentTabBookmark] = useState<Bookmark | null>(null);

  const handleOpenDashboard = useCallback(() => {
    if (chrome?.tabs && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html?target=dashboard') });
    } else {
      window.open('index.html?target=dashboard', '_blank');
    }
  }, []);

  useEffect(() => {
    if (isLoaded && !isDashboard && chrome?.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const tab = tabs[0];
        if (tab?.url && !tab.url.startsWith('chrome://')) {
          const existing = state.bookmarks.find(b => b.url === tab.url);
          setCurrentTabBookmark(existing || null);
        }
      });
    }
  }, [isLoaded, state.bookmarks, isDashboard]);

  // ─── Derived State ─────────────────────────────────────────────────────────

  const descendantsMap = useMemo(() => buildDescendantsMap(state.collections), [state.collections]);

  const filtered = useMemo(() => {
    let result = state.bookmarks;

    if (activeCollection === COLLECTION.TRASH) {
      result = result.filter((b) => b.collectionId === COLLECTION.TRASH);
    } else {
      result = result.filter((b) => b.collectionId !== COLLECTION.TRASH);
      if (activeCollection === COLLECTION.UNSORTED) {
        result = result.filter((b) => b.collectionId === COLLECTION.UNSORTED);
      } else if (activeCollection !== COLLECTION.ALL) {
        const descendants = descendantsMap.get(activeCollection);
        result = result.filter((b) => b.collectionId === activeCollection || !!descendants?.has(b.collectionId));
      }
    }

    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (activeTags.length > 0) {
      result = result.filter((b) => activeTags.every(t => b.tags.includes(t)));
    }

    return result;
  }, [state.bookmarks, activeCollection, debouncedSearchQuery, activeTags, descendantsMap]);

  const filteredBookmarks = useMemo(() => {
    return filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      switch (sortOrder) {
        case 'oldest': return a.createdAt - b.createdAt;
        case 'a-z': return a.title.localeCompare(b.title);
        case 'z-a': return b.title.localeCompare(a.title);
        case 'newest':
        default:
          if (typeof a.order === 'number' && typeof b.order === 'number') {
            return a.order - b.order;
          }
          return b.createdAt - a.createdAt;
      }
    });
  }, [filtered, sortOrder]);

  const bookmarkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let allCount = 0;
    let unsortedCount = 0;
    let trashCount = 0;
    for (const b of state.bookmarks) {
      if (b.collectionId === COLLECTION.TRASH) trashCount++;
      else {
        allCount++;
        if (b.collectionId === COLLECTION.UNSORTED) unsortedCount++;
      }
    }
    counts[COLLECTION.ALL] = allCount;
    counts[COLLECTION.UNSORTED] = unsortedCount;
    counts[COLLECTION.TRASH] = trashCount;

    for (const c of state.collections) {
      const descendants = descendantsMap.get(c.id);
      let count = 0;
      for (const b of state.bookmarks) {
        if (b.collectionId === c.id || !!descendants?.has(b.collectionId)) count++;
      }
      counts[c.id] = count;
    }
    return counts;
  }, [state.bookmarks, state.collections, descendantsMap]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    state.bookmarks.forEach((b) => b.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [state.bookmarks]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    filtered.forEach((b) => b.tags.forEach((t) => {
      if (!activeTags.includes(t)) tags.add(t);
    }));
    return Array.from(tags).sort();
  }, [filtered, activeTags]);

  // ─── Save Handlers ─────────────────────────────────────────────────────────

  const handleSaveBookmark = async (data: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (modal.initial?.id) {
      await send({ type: 'BM:updateBookmark', payload: { ...data, id: modal.initial.id } });
      showToast('Bookmark updated');
    } else {
      await send({ type: 'BM:addBookmark', payload: data });
      showToast('Bookmark added');
    }
  };

  const handleSaveCollection = async (data: { name: string; icon: CollectionIcon; color: CollectionColor }) => {
    const editing = modal.type === 'collection' && modal.existing;
    if (editing && modal.existing) {
      await send({ type: 'BM:updateCollection', payload: { ...modal.existing, ...data, id: modal.existing.id } });
      showToast('Collection updated');
    } else {
      await send({ type: 'BM:addCollection', payload: data });
      showToast(`Collection "${data.name}" created`);
    }
  };

  const handleQuickAddCollection = async (name: string) => {
    await send({ type: 'BM:addCollection', payload: { name, icon: 'folder', color: 'blue' } });
    showToast(`Collection "${name}" created`);
  };

  // ─── Action Handlers ───────────────────────────────────────────────────────

  const handleDropBookmark = useCallback(async (bookmarkId: string, collectionId: string) => {
    if (collectionId === COLLECTION.ALL) return;

    const bookmark = state.bookmarks.find(b => b.id === bookmarkId);
    if (!bookmark || bookmark.collectionId === collectionId) return;

    if (collectionId === COLLECTION.TRASH) {
      handleDeleteBookmark(bookmarkId, false);
      return;
    }

    await send({ type: 'BM:updateBookmark', payload: { ...bookmark, collectionId } });
    showToast('Bookmark moved');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bookmarks, send, showToast]);

  const handleDropCollection = useCallback(async (draggedId: string, targetId: string | null) => {
    if (draggedId === targetId) return;

    let current = targetId;
    while (current) {
      if (current === draggedId) {
        showToast("Cannot move a folder into itself or its children");
        return;
      }
      const parentColl = state.collections.find(c => c.id === current);
      current = parentColl?.parentId || null;
    }

    const draggedColl = state.collections.find(c => c.id === draggedId);
    if (!draggedColl) return;

    await send({ type: 'BM:updateCollection', payload: { ...draggedColl, parentId: targetId || undefined } });
    showToast('Collection moved');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.collections, send, showToast]);

  const handleTogglePinCollection = useCallback(async (id: string) => {
    const collection = state.collections.find(c => c.id === id);
    if (!collection) return;

    await send({ type: 'BM:updateCollection', payload: { ...collection, pinned: !collection.pinned } });
    showToast(collection.pinned ? 'Collection unpinned' : 'Collection pinned');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.collections, send, showToast]);

  const handleImport = async () => {
    if (window.confirm('Do you want to import your current browser bookmarks? This will merge them with your existing bookmarks.')) {
      showToast('Importing browser bookmarks...');
      await send({ type: 'BM:importBrowser' });
      showToast('Imported browser bookmarks');
    }
  };

  const handleExportData = useCallback(() => {
    let url: string | null = null;
    try {
      const data = {
        bookmarks: state.bookmarks,
        collections: state.collections,
        exportDate: new Date().toISOString(),
        version: '1.0'
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookmarks-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showToast('Bookmarks exported successfully');
    } catch {
      showToast('Failed to export bookmarks');
    } finally {
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  }, [state.bookmarks, state.collections, showToast]);

  const handleRefreshPreviews = async () => {
    showToast('Refreshing missing previews...');
    await send({ type: 'BM:refreshPreviews' });
    showToast('Finished refreshing previews!');
  };

  const handleImportJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data && Array.isArray(data.bookmarks) && Array.isArray(data.collections)) {
          await send({ type: 'BM:importData', payload: { bookmarks: data.bookmarks, collections: data.collections } });
          showToast('Imported bookmarks from JSON');
        } else {
          showToast('Invalid JSON format');
        }
      } catch {
        showToast('Failed to read JSON file');
      }
    };
    input.click();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, showToast]);

  const handleTogglePin = useCallback(async (id: string) => {
    await send({ type: 'BM:togglePin', id });
  }, [send]);

  const handleEditBookmark = useCallback((bookmark: Bookmark) => {
    setModal({ type: 'add', initial: bookmark });
  }, []);

  const handleDeleteBookmark = useCallback(async (id: string, isFromTrash: boolean) => {
    if (isFromTrash) {
      if (!confirm('Permanently delete this bookmark? This cannot be undone.')) return;
      await send({ type: 'BM:deleteBookmark', id });
      showToast('Bookmark permanently deleted');
    } else {
      const bookmark = state.bookmarks.find((b) => b.id === id);
      await send({ type: 'BM:moveToTrash', id });
      showToast('Moved to trash', bookmark ? {
        label: 'Undo',
        onClick: async () => {
          await send({ type: 'BM:updateBookmark', payload: bookmark });
          showToast('Bookmark restored');
        },
      } : undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bookmarks, send, showToast]);

  const handleRestoreBookmark = useCallback(async (id: string) => {
    await send({ type: 'BM:restoreFromTrash', id });
    showToast('Bookmark restored');
  }, [send, showToast]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === filteredBookmarks.length) {
        return new Set();
      }
      return new Set(filteredBookmarks.map(b => b.id));
    });
  }, [filteredBookmarks]);

  const handleToggleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleReorder = useCallback(async (dragId: string, dropId: string) => {
    const dragIndex = state.bookmarks.findIndex(b => b.id === dragId);
    const dropIndex = state.bookmarks.findIndex(b => b.id === dropId);
    if (dragIndex === -1 || dropIndex === -1) return;

    const reordered = [...state.bookmarks];
    const [removed] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, removed);
    const nextBookmarks = reordered.map((bookmark, index) => ({ ...bookmark, order: index }));

    await send({ type: 'BM:saveBookmarks', payload: nextBookmarks });
  }, [state.bookmarks, send]);

  const handleBulkDelete = useCallback(async () => {
    if (activeCollection === COLLECTION.TRASH) {
      if (confirm(`Are you sure you want to permanently delete ${selectedIds.size} bookmarks?`)) {
        await send({ type: 'BM:bulkDelete', ids: Array.from(selectedIds) });
        setSelectedIds(new Set());
      }
    } else {
      const bookmarksToRestore = state.bookmarks.filter((b) => selectedIds.has(b.id));
      await send({ type: 'BM:bulkMoveToTrash', ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      showToast(`${bookmarksToRestore.length} bookmarks moved to trash`, bookmarksToRestore.length > 0 ? {
        label: 'Undo',
        onClick: async () => {
          for (const bookmark of bookmarksToRestore) {
            await send({ type: 'BM:updateBookmark', payload: bookmark });
          }
          showToast('Bookmarks restored');
        },
      } : undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollection, selectedIds, state.bookmarks, send, showToast]);

  // Reset selection when searching (collection reset handled in handleSelectCollection)
  useEffect(() => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }, [searchQuery]);

  const handleCancelSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleSelectCollection = useCallback((id: string) => {
    startTransition(() => {
      setActiveCollection(id);
      setActiveTags([]);
      setSelectedIds(new Set());
      setIsSelectMode(false);
    });
  }, []);

  const handleToggleTag = useCallback((t: string) => {
    setActiveTags(prev =>
      prev.includes(t) ? prev.filter(tag => tag !== t) : [...prev, t]
    );
  }, []);

  const handleTagClick = useCallback((t: string) => {
    setActiveTags(prev => prev.includes(t) ? prev : [...prev, t]);
  }, []);

  const handleToggleAi = useCallback(() => {
    const nextState = !(state.settings?.enableAi ?? false);
    send({ type: 'BM:updateSettings', payload: { enableAi: nextState } });
    showToast(nextState ? 'AI Auto-Tagging Enabled' : 'AI Auto-Tagging Disabled');
  }, [state.settings, send, showToast]);

  const handleEditCollectionById = useCallback((id: string) => {
    const collection = state.collections.find(c => c.id === id);
    if (collection) {
      setModal({ type: 'collection', existing: collection });
    }
  }, [state.collections]);

  if (!isLoaded) {
    return (
      <div className={`flex bg-[#fafafa] text-zinc-900 overflow-hidden font-sans ${isDashboard ? 'h-screen w-full' : 'w-[800px] h-[600px]'}`}>
        <SidebarSkeleton />
        <main className="flex-1 flex flex-col min-w-0 bg-[#fafafa]">
          <SearchBarSkeleton />
          <div className="flex-1 overflow-hidden">
            <BookmarkListSkeleton count={6} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`flex bg-[#fafafa] text-zinc-900 overflow-hidden font-sans ${isDashboard ? 'h-screen w-full' : 'w-[800px] h-[600px]'}`}>
      <Sidebar
        collections={state.collections}
        activeCollection={activeCollection}
        onSelectCollection={handleSelectCollection}
        bookmarkCounts={bookmarkCounts}
        onNewCollection={() => setModal({ type: 'collection' })}
        onImport={handleImport}
        onImportJson={handleImportJson}
        onExport={handleExportData}
        onRefreshPreviews={handleRefreshPreviews}
        activeTags={activeTags}
        availableTags={availableTags}
        onToggleTag={handleToggleTag}
        onOpenDashboard={!isDashboard ? handleOpenDashboard : undefined}
        onEditCollection={handleEditCollectionById}
        onTogglePinCollection={handleTogglePinCollection}
        enableAi={state.settings?.enableAi ?? false}
        onToggleAi={handleToggleAi}
        onDropBookmark={handleDropBookmark}
        onDropCollection={handleDropCollection}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#fafafa]">
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          layoutScope={viewMode === 'folder' ? 'collection' : 'bookmark'}
          layoutColumns={viewMode === 'folder' ? collectionColumns : bookmarkColumns}
          onLayoutColumnsChange={viewMode === 'folder' ? handleCollectionColumnsChange : handleBookmarkColumnsChange}
          allowFolderView={activeCollection === COLLECTION.ALL && isDashboard}
          onAdd={() => setModal({ type: 'add' })}
          currentTabBookmarked={!!currentTabBookmark}
          onEditCurrent={currentTabBookmark ? () => handleEditBookmark(currentTabBookmark) : undefined}
          selectedCount={selectedIds.size}
          isAllSelected={selectedIds.size > 0 && selectedIds.size === filteredBookmarks.length && filteredBookmarks.length > 0}
          onSelectAll={handleSelectAll}
          onBulkDelete={handleBulkDelete}
          isTrashView={activeCollection === COLLECTION.TRASH}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          isSelectMode={isSelectMode}
          onToggleSelectMode={() => setIsSelectMode(true)}
          onCancelSelectMode={handleCancelSelectMode}
          activeTags={activeTags}
          onRemoveTag={handleToggleTag}
          onClearAllFilters={() => {
            setSearchQuery('');
            setActiveTags([]);
          }}
        />
        <div className={`flex-1 overflow-hidden relative ${isPending ? 'opacity-60' : 'opacity-100'} transition-opacity duration-150`}>
          {viewMode === 'folder' && activeCollection === COLLECTION.ALL ? (
            <FolderView
              collections={state.collections}
              bookmarks={filteredBookmarks}
              viewMode="list"
              collectionColumns={collectionColumns}
              onEdit={handleEditBookmark}
              onDelete={handleDeleteBookmark}
              onRestore={handleRestoreBookmark}
              onTogglePin={handleTogglePin}
              onToggleSelect={handleToggleSelect}
              onTagClick={handleTagClick}
              selectedIds={selectedIds}
              isSelectMode={isSelectMode}
              onNewCollection={() => setModal({ type: 'collection' })}
              onReorder={handleReorder}
              isDashboard={isDashboard}
            />
          ) : (
            <BookmarkList
              bookmarks={filteredBookmarks}
              viewMode={viewMode === 'folder' ? 'grid' : viewMode}
              bookmarkColumns={bookmarkColumns}
              searchQuery={searchQuery}
              activeTags={activeTags}
              activeCollection={activeCollection}
              onClearSearch={() => setSearchQuery('')}
              onClearFilters={() => {
                setSearchQuery('');
                setActiveTags([]);
              }}
              onAdd={() => setModal({ type: 'add' })}
              onEdit={handleEditBookmark}
              onDelete={handleDeleteBookmark}
              onRestore={handleRestoreBookmark}
              isTrashView={false}
              onTogglePin={handleTogglePin}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              isSelectMode={isSelectMode}
              onTagClick={handleTagClick}
              onReorder={handleReorder}
              isDashboard={isDashboard}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <Suspense fallback={<ModalSkeleton />}>
        {modal.type === 'add' && (
          <AddBookmarkModal
            initial={modal.initial}
            existingBookmarks={state.bookmarks}
            collections={state.collections}
            allTags={allTags}
            onSave={handleSaveBookmark}
            onQuickAddCollection={handleQuickAddCollection}
            onClose={() => setModal({ type: 'none' })}
          />
        )}

        {modal.type === 'collection' && (
          <CollectionModal
            existing={modal.existing}
            collections={state.collections}
            onSave={handleSaveCollection}
            onDelete={async (id: string) => {
              if (confirm('Are you sure you want to delete this collection and its sub-collections? Bookmarks will be moved to Unsorted.')) {
                await send({ type: 'BM:deleteCollection', id });
                showToast('Collection deleted');
                if (activeCollection === id) {
                  setActiveCollection(COLLECTION.ALL);
                }
                setModal({ type: 'none' });
              }
            }}
            onClose={() => setModal({ type: 'none' })}
          />
        )}
      </Suspense>

      {/* Toast stack */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto bg-white text-zinc-900 border border-zinc-200 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 animate-slide-up"
            role="status"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {t.msg}
            {t.action && (
              <button
                onClick={async () => {
                  const action = t.action;
                  if (!action) return;
                  dismissToast(t.id);
                  await action.onClick();
                }}
                className="ml-2 text-blue-600 hover:text-blue-700 font-semibold"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
