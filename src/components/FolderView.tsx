import { memo, useMemo } from 'react';
import { BookmarkCard, type ReorderPosition } from './BookmarkCard';
import {
  Folder,
  Inbox,
  LayoutGrid,
  Trash2,
  Plus,
  Star,
  Heart,
  Briefcase,
  Book,
  Code,
  Music,
  Film,
  ShoppingCart,
  Globe,
} from 'lucide-react';
import type { Bookmark, Collection, CollectionColor, CollectionIcon } from '../types';
import { COLLECTION } from '../types';
import { getCollectionDescendants } from '../utils';

interface FolderViewProps {
  collections: Collection[];
  bookmarks: Bookmark[];
  viewMode: 'grid' | 'list' | 'masonry';
  collectionColumns: 1 | 2 | 3 | 4 | 5;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleSelect: (id: string, selected: boolean) => void;
  onTagClick: (tag: string) => void;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  onNewCollection: () => void;
  onReorder?: (dragId: string, dropId: string, position?: ReorderPosition) => void;
  isDashboard?: boolean;
}

const getIconForCollection = (iconName: CollectionIcon) => {
  switch (iconName) {
    case 'folder': return Folder;
    case 'star': return Star;
    case 'heart': return Heart;
    case 'briefcase': return Briefcase;
    case 'book': return Book;
    case 'code': return Code;
    case 'music': return Music;
    case 'film': return Film;
    case 'shopping-cart': return ShoppingCart;
    case 'globe': return Globe;
    default: return Folder;
  }
};

const getColorClasses = (color: string) => {
  const map: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900',
    violet: 'bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900',
    rose: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
    orange: 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900',
    amber: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
    teal: 'bg-teal-50 text-teal-600 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-900',
    cyan: 'bg-cyan-50 text-cyan-600 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-900',
    pink: 'bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-950/40 dark:text-pink-400 dark:border-pink-900',
  };
  return map[color] || map.blue;
};

function FolderViewInner({
  collections,
  bookmarks,
  viewMode,
  collectionColumns,
  onEdit,
  onDelete,
  onRestore,
  onTogglePin,
  onToggleSelect,
  onTagClick,
  selectedIds,
  isSelectMode,
  onNewCollection,
  onReorder,
  isDashboard,
}: FolderViewProps) {
  const trashBookmarks = useMemo(
    () => bookmarks.filter((b) => b.collectionId === COLLECTION.TRASH),
    [bookmarks]
  );

  // Group bookmarks per collection once per (collections, bookmarks) change instead of
  // re-running getCollectionDescendants + a full filter for every collection on every render.
  const allFolders = useMemo(() => {
    const nonTrashBookmarks = bookmarks.filter((b) => b.collectionId !== COLLECTION.TRASH);
    const unsortedBookmarks = nonTrashBookmarks.filter(
      (b) => b.collectionId === COLLECTION.UNSORTED
    );
    const getBookmarksForCollection = (collectionId: string): Bookmark[] => {
      const descendants = getCollectionDescendants(collections, collectionId);
      return nonTrashBookmarks.filter(
        (b) => b.collectionId === collectionId || descendants.has(b.collectionId)
      );
    };
    const sortedCollections = [...collections].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.name.localeCompare(b.name);
    });
    return [
      { id: COLLECTION.ALL, label: 'All Bookmarks', icon: LayoutGrid, color: 'blue' as CollectionColor, bookmarks: nonTrashBookmarks },
      { id: COLLECTION.UNSORTED, label: 'Unsorted', icon: Inbox, color: 'amber' as CollectionColor, bookmarks: unsortedBookmarks },
      ...sortedCollections.map((c) => ({
        id: c.id,
        label: c.name,
        icon: getIconForCollection(c.icon),
        color: c.color,
        bookmarks: getBookmarksForCollection(c.id),
      })),
    ];
  }, [collections, bookmarks]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className={`p-5 space-y-6 ${isDashboard ? 'w-full' : 'max-w-7xl mx-auto'}`}>
        {/* Folders Grid */}
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 mb-4">Collections</h2>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${collectionColumns}, minmax(0, 1fr))` }}>
            {allFolders.map((folder) => {
              const Icon = folder.icon;
              const colorClasses = getColorClasses(folder.color);
              return (
                <div
                  key={folder.id}
                  className="bg-white border border-zinc-200/80 rounded-xl p-5 hover:shadow-md hover:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-700 transition-all duration-200"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClasses} border`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{folder.label}</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{folder.bookmarks.length} bookmark{folder.bookmarks.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>

                  {folder.bookmarks.length > 0 ? (
                    <div className="grid gap-2 mt-3 max-h-[520px] overflow-y-auto custom-scrollbar pr-1" style={{ gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' }}>
                      {folder.bookmarks.map((bookmark) => (
                        <BookmarkCard
                          key={bookmark.id}
                          bookmark={bookmark}
                          viewMode="list"
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onRestore={onRestore}
                          isTrash={false}
                          isSelected={selectedIds.has(bookmark.id)}
                          onToggleSelect={onToggleSelect}
                          onTogglePin={onTogglePin}
                          isSelectMode={isSelectMode}
                          onTagClick={onTagClick}
                          compact
                          draggable={!!onReorder && !isSelectMode}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/bookmark-id', bookmark.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => { e.preventDefault(); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const dragId = e.dataTransfer.getData('application/bookmark-id');
                            if (dragId && dragId !== bookmark.id && onReorder) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const position: ReorderPosition =
                                e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                              onReorder(dragId, bookmark.id, position);
                            }
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center py-2">No bookmarks yet</p>
                  )}
                </div>
              );
            })}

            {/* New Collection Card */}
            <button
              onClick={onNewCollection}
              className="bg-white border-2 border-dashed border-zinc-300 rounded-xl p-5 flex flex-col items-center justify-center gap-3 hover:border-zinc-400 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60 transition-all duration-200 min-h-[120px]"
            >
              <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <Plus className="w-5 h-5 text-zinc-400" />
              </div>
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">New Collection</span>
            </button>
          </div>
        </div>

        {/* Trash Section */}
        {trashBookmarks.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              </div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">Trash</h3>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">({trashBookmarks.length} bookmark{trashBookmarks.length !== 1 ? 's' : ''})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {trashBookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  viewMode="list"
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  isTrash={true}
                  isSelected={selectedIds.has(bookmark.id)}
                  onToggleSelect={onToggleSelect}
                  onTogglePin={onTogglePin}
                  isSelectMode={isSelectMode}
                  onTagClick={onTagClick}
                  compact
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const FolderView = memo(FolderViewInner);
