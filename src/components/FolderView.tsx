import { memo, useMemo, useState } from 'react';
import { BookmarkCard, type ReorderPosition } from './BookmarkCard';
import { Inbox, LayoutGrid, Trash2, Plus, ArrowUpRight } from 'lucide-react';
import type { Bookmark, Collection, CollectionColor, LocaleCode } from '../types';
import { COLLECTION } from '../types';
import { getCollectionDescendants } from '../utils';
import { createT } from '../i18n';
import { COLLECTION_BADGE_BG, getCollectionIcon } from '../collectionIcons';

interface FolderViewProps {
  collections: Collection[];
  bookmarks: Bookmark[];
  viewMode: 'grid' | 'list' | 'masonry';
  collectionColumns: 1 | 2 | 3 | 4 | 5;
  /** bookmarkId → closest saved ancestor (for sub-page badges) */
  relatedRoots?: Map<string, Bookmark>;
  onSelectCollection?: (id: string) => void;
  onAddInCollection?: (collectionId: string) => void;
  onDropBookmark?: (bookmarkId: string, collectionId: string) => void;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  onCopyUrl?: (url: string) => void;
  onTogglePin: (id: string) => void;
  onToggleSelect: (id: string, selected: boolean, shiftKey?: boolean) => void;
  onTagClick: (tag: string) => void;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  onNewCollection: () => void;
  onReorder?: (dragId: string, dropId: string, position?: ReorderPosition) => void;
  isDashboard?: boolean;
  locale?: LocaleCode;
}

function FolderViewInner({
  collections,
  bookmarks,
  collectionColumns,
  relatedRoots,
  onSelectCollection,
  onAddInCollection,
  onDropBookmark,
  onEdit,
  onDelete,
  onRestore,
  onCopyUrl,
  onTogglePin,
  onToggleSelect,
  onTagClick,
  selectedIds,
  isSelectMode,
  onNewCollection,
  onReorder,
  locale = 'en',
}: FolderViewProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const trashBookmarks = useMemo(
    () => bookmarks.filter((b) => b.collectionId === COLLECTION.TRASH),
    [bookmarks]
  );

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
      {
        id: COLLECTION.ALL,
        label: t('allBookmarks'),
        icon: LayoutGrid,
        color: 'blue' as CollectionColor,
        bookmarks: nonTrashBookmarks,
        canDrop: false,
      },
      {
        id: COLLECTION.UNSORTED,
        label: t('unsorted'),
        icon: Inbox,
        color: 'amber' as CollectionColor,
        bookmarks: unsortedBookmarks,
        canDrop: true,
      },
      ...sortedCollections.map((c) => ({
        id: c.id,
        label: c.name,
        icon: getCollectionIcon(c.icon),
        color: c.color,
        bookmarks: getBookmarksForCollection(c.id),
        canDrop: true,
      })),
    ];
  }, [collections, bookmarks, t]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-5 space-y-6 w-full max-w-7xl mx-auto">
        <div>
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(max(260px, calc((100% - ${(collectionColumns - 1) * 16}px) / ${collectionColumns})), 1fr))`,
            }}
          >
            {allFolders.map((folder) => {
              const Icon = folder.icon;
              const colorClasses = COLLECTION_BADGE_BG[folder.color] || COLLECTION_BADGE_BG.blue;
              const isDropTarget = dragOverFolderId === folder.id;

              return (
                <div
                  key={folder.id}
                  onDragOver={(e) => {
                    if (
                      folder.canDrop &&
                      e.dataTransfer.types.includes('application/bookmark-id')
                    ) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverFolderId !== folder.id) setDragOverFolderId(folder.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverFolderId((cur) => (cur === folder.id ? null : cur));
                    }
                  }}
                  onDrop={(e) => {
                    if (!folder.canDrop) return;
                    e.preventDefault();
                    setDragOverFolderId(null);
                    const dragId = e.dataTransfer.getData('application/bookmark-id');
                    if (dragId && onDropBookmark) {
                      onDropBookmark(dragId, folder.id);
                    }
                  }}
                  className={`bg-white border rounded-xl p-4 transition-all duration-200 flex flex-col dark:bg-zinc-900 ${
                    isDropTarget
                      ? 'border-brand-500 ring-2 ring-brand-500/25 shadow-md'
                      : 'border-zinc-200/80 hover:shadow-md hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() => onSelectCollection?.(folder.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left group/hdr"
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colorClasses} border`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50 truncate group-hover/hdr:text-brand-600 dark:group-hover/hdr:text-brand-400 transition-colors flex items-center gap-1">
                          <span className="truncate">{folder.label}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover/hdr:opacity-70 shrink-0 transition-opacity" />
                        </h3>
                        <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                          {folder.bookmarks.length} {t('bookmarksLabel')}
                        </p>
                      </div>
                    </button>

                    {folder.canDrop && onAddInCollection && (
                      <button
                        type="button"
                        onClick={() => onAddInCollection(folder.id)}
                        className="btn-icon-sm text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
                        title={t('addToCollection')}
                        aria-label={t('addToCollection')}
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {folder.bookmarks.length > 0 ? (
                    <div className="flex flex-col gap-0.5 max-h-[460px] overflow-y-auto custom-scrollbar pr-0.5">
                      {folder.bookmarks.map((bookmark) => (
                        <BookmarkCard
                          key={bookmark.id}
                          bookmark={bookmark}
                          viewMode="list"
                          relatedRoot={relatedRoots?.get(bookmark.id)}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onRestore={onRestore}
                          onCopyUrl={onCopyUrl}
                          isTrash={false}
                          isSelected={selectedIds.has(bookmark.id)}
                          onToggleSelect={onToggleSelect}
                          onTogglePin={onTogglePin}
                          isSelectMode={isSelectMode}
                          onTagClick={onTagClick}
                          compact
                          locale={locale}
                          draggable={!!onReorder && !isSelectMode}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/bookmark-id', bookmark.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                          }}
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
                    <p className="text-[12px] text-zinc-400 dark:text-zinc-500 text-center py-6">
                      {t('noBookmarks')}
                    </p>
                  )}
                </div>
              );
            })}

            {/* New Collection Card */}
            <button
              type="button"
              onClick={onNewCollection}
              className="bg-white border-2 border-dashed border-zinc-200 rounded-xl p-5 flex flex-col items-center justify-center gap-2.5 hover:border-brand-300 hover:bg-brand-50/30 dark:bg-zinc-900 dark:border-zinc-700 dark:hover:border-brand-700 dark:hover:bg-brand-950/20 transition-all duration-200 min-h-[140px]"
            >
              <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <Plus className="w-5 h-5 text-zinc-400" />
              </div>
              <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">
                {t('newCollection')}
              </span>
            </button>
          </div>
        </div>

        {/* Trash Section */}
        {trashBookmarks.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{t('trash')}</h3>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                ({trashBookmarks.length} {t('bookmarksLabel')})
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {trashBookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  viewMode="list"
                  relatedRoot={relatedRoots?.get(bookmark.id)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  onCopyUrl={onCopyUrl}
                  isTrash={true}
                  isSelected={selectedIds.has(bookmark.id)}
                  onToggleSelect={onToggleSelect}
                  onTogglePin={onTogglePin}
                  isSelectMode={isSelectMode}
                  onTagClick={onTagClick}
                  compact
                  locale={locale}
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
