import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkCard, type ReorderPosition } from './BookmarkCard';
import type { Bookmark, Collection, LocaleCode } from '../types';
import { BookmarkPlus, Search, Trash2 } from 'lucide-react';
import { COLLECTION } from '../types';
import { createT } from '../i18n';
import { Button } from './ui/Button';

interface BookmarkListProps {
  bookmarks: Bookmark[];
  collections?: Collection[];
  showCollectionBadge?: boolean;
  onCollectionClick?: (collectionId: string) => void;
  viewMode: 'grid' | 'list' | 'masonry';
  bookmarkColumns: 1 | 2 | 3 | 4 | 5;
  relatedRoots?: Map<string, Bookmark>;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  onCopyUrl?: (url: string) => void;
  isTrashView?: boolean;
  selectedIds?: Set<string>;
  focusedIndex?: number;
  onToggleSelect?: (id: string, selected: boolean, shiftKey?: boolean) => void;
  onTogglePin?: (id: string) => void;
  isSelectMode?: boolean;
  onTagClick?: (tag: string) => void;
  searchQuery?: string;
  highlightQuery?: string;
  activeTags?: string[];
  activeCollection?: string;
  onClearSearch?: () => void;
  onClearFilters?: () => void;
  onAdd?: () => void;
  onReorder?: (dragId: string, dropId: string, position?: ReorderPosition) => void;
  isDashboard?: boolean;
  locale?: LocaleCode;
}

const LIST_ROW_HEIGHT = 68;
const OVERSCAN = 8;

function BookmarkListInner({
  bookmarks,
  collections = [],
  showCollectionBadge = false,
  onCollectionClick,
  viewMode,
  bookmarkColumns,
  relatedRoots,
  onEdit,
  onDelete,
  onRestore,
  onCopyUrl,
  isTrashView = false,
  selectedIds = new Set(),
  focusedIndex = -1,
  onToggleSelect,
  onTogglePin,
  isSelectMode = false,
  onTagClick,
  searchQuery = '',
  highlightQuery = '',
  activeTags = [],
  activeCollection = COLLECTION.ALL,
  onClearSearch,
  onClearFilters,
  onAdd,
  onReorder,
  isDashboard,
  locale = 'en',
}: BookmarkListProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [viewportW, setViewportW] = useState(1000);

  const collectionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections) map.set(c.id, c.name);
    return map;
  }, [collections]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight);
      setViewportW(el.clientWidth);
    });
    ro.observe(el);
    setViewportH(el.clientHeight);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, [viewMode, bookmarks.length]);

  const uniformRowHeight = useMemo(() => !bookmarks.some((b) => Boolean(b.note)), [bookmarks]);

  const virtual = useMemo(() => {
    if (viewMode !== 'list' || bookmarks.length < 100 || !uniformRowHeight) {
      return null;
    }
    const start = Math.max(0, Math.floor(scrollTop / LIST_ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewportH / LIST_ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(bookmarks.length, start + visible);
    return { start, end, totalH: bookmarks.length * LIST_ROW_HEIGHT };
  }, [viewMode, bookmarks.length, scrollTop, viewportH, uniformRowHeight]);

  useEffect(() => {
    if (focusedIndex < 0 || !scrollRef.current) return;
    const el = scrollRef.current;
    if (virtual) {
      const top = focusedIndex * LIST_ROW_HEIGHT;
      const bottom = top + LIST_ROW_HEIGHT;
      if (top < el.scrollTop) {
        el.scrollTop = top;
      } else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight;
      }
      return;
    }
    const target = el.querySelector<HTMLElement>(`[data-bm-idx="${focusedIndex}"]`);
    target?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, virtual]);

  if (bookmarks.length === 0) {
    const hasSearch = searchQuery.trim().length > 0;
    const hasTags = activeTags.length > 0;
    const title = hasSearch
      ? t('noResultsFor', { query: searchQuery.trim() })
      : hasTags
        ? t('noTagMatches')
        : activeCollection === COLLECTION.TRASH
          ? t('trashEmpty')
          : activeCollection === COLLECTION.ALL
            ? t('noBookmarks')
            : t('noBookmarksInCollection');
    const description =
      hasSearch || hasTags
        ? t('tryClearingHint')
        : activeCollection === COLLECTION.TRASH
          ? t('trashEmptyHint')
          : t('startLibraryHint');

    const EmptyIcon =
      hasSearch || hasTags
        ? Search
        : activeCollection === COLLECTION.TRASH
          ? Trash2
          : BookmarkPlus;

    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-12 h-12 bg-[var(--surface)] border border-[var(--border)] rounded-[12px] flex items-center justify-center mb-3.5 text-[var(--text-muted)]">
          <EmptyIcon className="w-5 h-5" />
        </div>
        <p className="text-[14px] font-semibold text-[var(--text)] m-0">{title}</p>
        <p className="text-[12.5px] text-[var(--text-muted)] mt-1.5 max-w-[300px] leading-relaxed m-0">
          {description}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {hasSearch && onClearSearch && (
            <Button variant="secondary" size="sm" onClick={onClearSearch}>
              {t('clearSearch')}
            </Button>
          )}
          {hasTags && onClearFilters && (
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              {t('clearFilters')}
            </Button>
          )}
          {!hasSearch && !hasTags && activeCollection !== COLLECTION.TRASH && onAdd && (
            <Button variant="primary" size="sm" onClick={onAdd}>
              {t('addBookmark')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const renderCard = (bookmark: Bookmark, idx: number) => (
    <div key={bookmark.id} data-bm-idx={idx}>
      <BookmarkCard
        bookmark={bookmark}
        viewMode={viewMode}
        relatedRoot={relatedRoots?.get(bookmark.id)}
        collectionName={showCollectionBadge ? collectionNames.get(bookmark.collectionId) : undefined}
        onCollectionClick={onCollectionClick}
        onEdit={onEdit}
        onDelete={onDelete}
        onRestore={onRestore}
        onCopyUrl={onCopyUrl}
        isTrash={isTrashView}
        isSelected={selectedIds.has(bookmark.id)}
        isFocused={idx === focusedIndex}
        onToggleSelect={onToggleSelect}
        onTogglePin={onTogglePin}
        isSelectMode={isSelectMode}
        onTagClick={onTagClick}
        highlightQuery={highlightQuery}
        locale={locale}
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
    </div>
  );

  if (viewMode === 'list') {
    return (
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto custom-scrollbar px-5 pt-2 pb-6"
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        {/* Unified clean *2k surface card matching TubeDeck2k opt-group-list */}
        <div className="w-full max-w-6xl mx-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden divide-y divide-[var(--border)]">
          {virtual ? (
            <div style={{ height: virtual.totalH, position: 'relative' }}>
              <div
                className="divide-y divide-[var(--border)]"
                style={{ transform: `translateY(${virtual.start * LIST_ROW_HEIGHT}px)` }}
              >
                {bookmarks
                  .slice(virtual.start, virtual.end)
                  .map((b, offset) => renderCard(b, virtual.start + offset))}
              </div>
            </div>
          ) : (
            bookmarks.map((b, idx) => renderCard(b, idx))
          )}
        </div>
      </div>
    );
  }

  const effectiveGridCols = Math.min(
    bookmarkColumns,
    Math.max(1, Math.floor(Math.max(viewportW - 40, 210) / 210))
  );

  const gridTemplateColumns =
    viewMode === 'grid'
      ? `repeat(${effectiveGridCols}, minmax(0, 1fr))`
      : isDashboard
        ? 'repeat(auto-fill, minmax(108px, 1fr))'
        : 'repeat(5, minmax(0, 1fr))';

  return (
    <div ref={scrollRef} className="h-full w-full overflow-y-auto custom-scrollbar">
      <div
        className={
          viewMode === 'grid'
            ? 'px-5 pt-2 pb-6 grid gap-3.5 max-w-7xl mx-auto'
            : 'px-5 pt-2 pb-6 grid gap-2.5 mx-auto'
        }
        style={{
          contain: 'layout',
          gridTemplateColumns,
        }}
      >
        {bookmarks.map((b, idx) => renderCard(b, idx))}
      </div>
    </div>
  );
}

export const BookmarkList = memo(BookmarkListInner);
