import { memo } from 'react';
import { BookmarkCard } from './BookmarkCard';
import type { Bookmark } from '../types';
import { LayoutGrid } from 'lucide-react';
import { COLLECTION } from '../types';

interface BookmarkListProps {
  bookmarks: Bookmark[];
  viewMode: 'grid' | 'list' | 'masonry';
  bookmarkColumns: 1 | 2 | 3 | 4 | 5;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  isTrashView?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string, selected: boolean) => void;
  onTogglePin?: (id: string) => void;
  isSelectMode?: boolean;
  onTagClick?: (tag: string) => void;
  searchQuery?: string;
  activeTags?: string[];
  activeCollection?: string;
  onClearSearch?: () => void;
  onClearFilters?: () => void;
  onAdd?: () => void;
  onReorder?: (dragId: string, dropId: string) => void;
  isDashboard?: boolean;
}

function BookmarkListInner({
  bookmarks,
  viewMode,
  bookmarkColumns,
  onEdit,
  onDelete,
  onRestore,
  isTrashView = false,
  selectedIds = new Set(),
  onToggleSelect,
  onTogglePin,
  isSelectMode = false,
  onTagClick,
  searchQuery = '',
  activeTags = [],
  activeCollection = COLLECTION.ALL,
  onClearSearch,
  onClearFilters,
  onAdd,
  onReorder,
  isDashboard,
}: BookmarkListProps) {
  if (bookmarks.length === 0) {
    const hasSearch = searchQuery.trim().length > 0;
    const hasTags = activeTags.length > 0;
    const title = hasSearch
      ? `No results for "${searchQuery.trim()}"`
      : hasTags
        ? 'No bookmarks match these tags'
        : activeCollection === COLLECTION.TRASH
          ? 'Trash is empty'
          : activeCollection === COLLECTION.ALL
            ? 'No bookmarks yet'
            : 'No bookmarks in this collection';
    const description = hasSearch || hasTags
      ? 'Try clearing your filters or searching for something else.'
      : activeCollection === COLLECTION.TRASH
        ? 'Deleted bookmarks will show up here.'
        : 'Add a bookmark to start building your library.';

    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-14 h-14 bg-white border border-zinc-200 shadow-sm rounded-2xl flex items-center justify-center mb-4 text-zinc-300">
          <LayoutGrid className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold text-zinc-600">{title}</p>
        <p className="text-xs text-zinc-400 mt-1.5 max-w-[280px]">{description}</p>
        <div className="mt-5 flex items-center gap-2">
          {hasSearch && onClearSearch && (
            <button
              onClick={onClearSearch}
              className="px-3 h-8 rounded-md text-[13px] font-medium text-zinc-600 bg-white border border-zinc-200 shadow-sm hover:bg-zinc-50 transition-colors"
            >
              Clear search
            </button>
          )}
          {(hasTags || (hasSearch && activeTags.length > 0)) && onClearFilters && (
            <button
              onClick={onClearFilters}
              className="px-3 h-8 rounded-md text-[13px] font-medium text-zinc-600 bg-white border border-zinc-200 shadow-sm hover:bg-zinc-50 transition-colors"
            >
              Clear filters
            </button>
          )}
          {!hasSearch && !hasTags && activeCollection !== COLLECTION.TRASH && onAdd && (
            <button
              onClick={onAdd}
              className="btn-brand-sm"
            >
              Add bookmark
            </button>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className={`flex flex-col ${isDashboard ? 'w-full' : 'max-w-5xl mx-auto'}`}>
          {bookmarks.map((bookmark) => (
            <BookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              viewMode={viewMode}
              onEdit={onEdit}
              onDelete={onDelete}
              onRestore={onRestore}
              isTrash={isTrashView}
              isSelected={selectedIds.has(bookmark.id)}
              onToggleSelect={onToggleSelect}
              onTogglePin={onTogglePin}
              isSelectMode={isSelectMode}
              onTagClick={onTagClick}
              draggable={!!onReorder && !isSelectMode}
              onDragStart={() => {}}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const dragId = e.dataTransfer.getData('application/bookmark-id');
                if (dragId && dragId !== bookmark.id && onReorder) {
                  onReorder(dragId, bookmark.id);
                }
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar">
      <div className={
        viewMode === 'grid'
          ? "p-5 grid gap-4"
          : "p-5 grid gap-3 mx-auto"
      } style={{
        contain: 'layout',
        gridTemplateColumns: viewMode === 'grid'
          ? `repeat(auto-fill, minmax(${Math.max(200, 320 - (bookmarkColumns - 1) * 40)}px, 1fr))`
          : `repeat(auto-fill, minmax(100px, 1fr))`
      }}>
        {bookmarks.map((bookmark) => (
          <BookmarkCard
            key={bookmark.id}
            bookmark={bookmark}
            viewMode={viewMode}
            onEdit={onEdit}
            onDelete={onDelete}
            onRestore={onRestore}
            isTrash={isTrashView}
            isSelected={selectedIds.has(bookmark.id)}
            onToggleSelect={onToggleSelect}
            onTogglePin={onTogglePin}
            isSelectMode={isSelectMode}
            onTagClick={onTagClick}
          />
        ))}
      </div>
    </div>
  );
}

export const BookmarkList = memo(BookmarkListInner);
