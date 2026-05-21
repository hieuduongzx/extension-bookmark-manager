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
      <div className="h-full flex flex-col items-center justify-center text-zinc-500">
        <div className="w-12 h-12 bg-white border border-zinc-200 shadow-sm rounded-xl flex items-center justify-center mb-4 text-zinc-400">
          <LayoutGrid className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-zinc-700">{title}</p>
        <p className="text-xs text-zinc-500 mt-1">{description}</p>
        <div className="mt-4 flex items-center gap-2">
          {hasSearch && onClearSearch && (
            <button
              onClick={onClearSearch}
              className="px-3 h-8 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 shadow-sm hover:bg-zinc-50 transition-colors"
            >
              Clear search
            </button>
          )}
          {(hasTags || (hasSearch && activeTags.length > 0)) && onClearFilters && (
            <button
              onClick={onClearFilters}
              className="px-3 h-8 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 shadow-sm hover:bg-zinc-50 transition-colors"
            >
              Clear filters
            </button>
          )}
          {!hasSearch && !hasTags && activeCollection !== COLLECTION.TRASH && onAdd && (
            <button
              onClick={onAdd}
              className="px-3 h-8 rounded-md text-[13px] font-medium bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 transition-colors"
            >
              Add bookmark
            </button>
          )}
        </div>
      </div>
    );
  }

  const colClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
  }[bookmarkColumns];

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className={`p-5 grid ${colClass} gap-2 ${isDashboard ? 'w-full' : 'max-w-5xl mx-auto'}`} style={{ contain: 'layout' }}>
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
          ? "p-5 grid grid-cols-2 lg:grid-cols-6 gap-4"
          : "p-5 grid grid-cols-8 lg:grid-cols-[repeat(20,minmax(0,1fr))] gap-3 mx-auto"
      } style={{ contain: 'layout' }}>
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
