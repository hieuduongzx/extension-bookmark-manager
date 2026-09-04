import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkCard, type ReorderPosition } from './BookmarkCard';
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
  onReorder?: (dragId: string, dropId: string, position?: ReorderPosition) => void;
  isDashboard?: boolean;
}

const LIST_ROW_HEIGHT = 64;
const OVERSCAN = 8;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, [viewMode, bookmarks.length]);

  // Virtualize only when every row is the uniform LIST_ROW_HEIGHT. A bookmark with a note
  // renders a taller row, which would make the fixed-height offset math drift (gaps/overlap
  // and a wrong scrollbar). In that case fall back to rendering the full list.
  const uniformRowHeight = useMemo(() => !bookmarks.some((b) => b.note), [bookmarks]);

  const virtual = useMemo(() => {
    if (viewMode !== 'list' || bookmarks.length < 80 || !uniformRowHeight) {
      return null;
    }
    const start = Math.max(0, Math.floor(scrollTop / LIST_ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewportH / LIST_ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(bookmarks.length, start + visible);
    return { start, end, totalH: bookmarks.length * LIST_ROW_HEIGHT };
  }, [viewMode, bookmarks.length, scrollTop, viewportH, uniformRowHeight]);

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
    const description =
      hasSearch || hasTags
        ? 'Try clearing your filters or searching for something else.'
        : activeCollection === COLLECTION.TRASH
          ? 'Deleted bookmarks will show up here.'
          : 'Add a bookmark to start building your library.';

    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-14 h-14 bg-brand-50 dark:bg-brand-950/40 border border-brand-100 dark:border-brand-900 rounded-2xl flex items-center justify-center mb-4 text-brand-400 dark:text-brand-500">
          <LayoutGrid className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 max-w-[280px]">{description}</p>
        <div className="mt-5 flex items-center gap-2">
          {hasSearch && onClearSearch && (
            <button onClick={onClearSearch} className="btn-ghost-sm">
              Clear search
            </button>
          )}
          {(hasTags || (hasSearch && activeTags.length > 0)) && onClearFilters && (
            <button onClick={onClearFilters} className="btn-ghost-sm">
              Clear filters
            </button>
          )}
          {!hasSearch && !hasTags && activeCollection !== COLLECTION.TRASH && onAdd && (
            <button onClick={onAdd} className="btn-brand-sm">
              Add bookmark
            </button>
          )}
        </div>
      </div>
    );
  }

  const renderCard = (bookmark: Bookmark) => (
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
      draggable={!!onReorder && !isSelectMode && viewMode === 'list'}
      onDragStart={() => {}}
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
  );

  if (viewMode === 'list') {
    return (
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto custom-scrollbar"
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div className={`flex flex-col ${isDashboard ? 'w-full' : 'max-w-5xl mx-auto'}`}>
          {virtual ? (
            <div style={{ height: virtual.totalH, position: 'relative' }}>
              <div style={{ transform: `translateY(${virtual.start * LIST_ROW_HEIGHT}px)` }}>
                {bookmarks.slice(virtual.start, virtual.end).map(renderCard)}
              </div>
            </div>
          ) : (
            bookmarks.map(renderCard)
          )}
        </div>
      </div>
    );
  }

  // Icon grid: fixed 6 columns in popup for denser scan; auto-fill on dashboard.
  // Card grid: column density driven by bookmarkColumns setting.
  const gridTemplateColumns =
    viewMode === 'grid'
      ? `repeat(auto-fill, minmax(${Math.max(200, 320 - (bookmarkColumns - 1) * 40)}px, 1fr))`
      : isDashboard
        ? 'repeat(auto-fill, minmax(100px, 1fr))'
        : 'repeat(6, minmax(0, 1fr))';

  return (
    <div ref={scrollRef} className="h-full w-full overflow-y-auto custom-scrollbar">
      <div
        className={viewMode === 'grid' ? 'p-5 grid gap-3' : 'p-5 grid gap-2.5 mx-auto'}
        style={{
          contain: 'layout',
          gridTemplateColumns,
        }}
      >
        {bookmarks.map(renderCard)}
      </div>
    </div>
  );
}

export const BookmarkList = memo(BookmarkListInner);
