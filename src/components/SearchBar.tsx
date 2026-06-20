import { useEffect, useRef } from 'react';
import { Search, Plus, LayoutGrid, LayoutList, CheckSquare, Square, Trash2, Edit, X, GripVertical, Hash, FolderTree, ArrowDownAZ } from 'lucide-react';
import { Dropdown } from './Dropdown';

type SortOrder = 'newest' | 'oldest' | 'a-z' | 'z-a';
type ViewMode = 'grid' | 'list' | 'masonry' | 'folder';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  layoutScope?: 'bookmark' | 'collection';
  layoutColumns?: 1 | 2 | 3 | 4 | 5;
  onLayoutColumnsChange?: (c: 1 | 2 | 3 | 4 | 5) => void;
  allowFolderView?: boolean;
  onAdd: () => void;
  selectedCount?: number;
  isAllSelected?: boolean;
  onSelectAll?: () => void;
  onBulkDelete?: () => void;
  isTrashView?: boolean;
  sortOrder?: SortOrder;
  onSortChange?: (order: SortOrder) => void;
  isSelectMode?: boolean;
  onToggleSelectMode?: () => void;
  onCancelSelectMode?: () => void;
  currentTabBookmarked?: boolean;
  onEditCurrent?: () => void;
  hideViewToggle?: boolean;
  activeTags?: string[];
  onRemoveTag?: (tag: string) => void;
  onClearAllFilters?: () => void;
}

export function SearchBar({ 
  searchQuery, 
  onSearchChange, 
  viewMode, 
  onViewModeChange, 
  layoutScope,
  layoutColumns,
  onLayoutColumnsChange,
  allowFolderView = false,
  onAdd,
  selectedCount = 0,
  isAllSelected = false,
  onSelectAll,
  onBulkDelete,
  isTrashView = false,
  sortOrder = 'newest',
  onSortChange,
  isSelectMode = false,
  onToggleSelectMode,
  onCancelSelectMode,
  currentTabBookmarked,
  onEditCurrent,
  hideViewToggle = false,
  activeTags = [],
  onRemoveTag,
  onClearAllFilters,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus on mount + listen for global "/" shortcut
  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (e.key === '/' && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (isSelectMode || selectedCount > 0) {
    return (
      <div className="flex items-center justify-between py-2.5 px-5 border-b border-brand-200 bg-brand-50/80 shrink-0 z-10 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={onSelectAll}
            className="flex items-center gap-2 px-2 py-1.5 text-brand-700 hover:bg-brand-100/50 rounded-md transition-colors font-medium text-[13px]"
          >
            {isAllSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {isAllSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span className="text-[13px] font-medium text-brand-900">
            {selectedCount} selected
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <button
              onClick={onBulkDelete}
              className="flex items-center gap-1.5 px-3 h-8 bg-red-600 hover:bg-red-700 text-white rounded-md text-[13px] font-medium transition-colors shadow-sm"
            >
              <Trash2 className="w-4 h-4" /> {isTrashView ? 'Delete Permanently' : 'Move to Trash'}
            </button>
          )}
          {onCancelSelectMode && (
            <button
              onClick={onCancelSelectMode}
              className="px-3 h-8 text-brand-700 hover:bg-brand-100/50 rounded-md text-[13px] font-medium transition-colors ml-2"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || activeTags.length > 0;

  return (
    <div className="border-b border-zinc-200/80 bg-white shrink-0 z-10 relative">
      <div className="flex items-center justify-between gap-3 py-3 px-5">
        <div className="flex flex-1 min-w-0 items-center gap-2.5">
          {onSelectAll && !isSelectMode && onToggleSelectMode && (
            <button
              onClick={onToggleSelectMode}
              title="Select multiple bookmarks"
              className="btn-icon-sm shrink-0"
            >
              <Edit className="w-4 h-4" />
            </button>
          )}
          <div className="relative flex-1 min-w-[140px] max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search bookmarks  (press /)"
              aria-label="Search bookmarks"
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-zinc-100 border border-transparent text-[13px] font-medium text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 rounded"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {onSortChange && (
            <Dropdown<SortOrder>
              size="sm"
              className="w-[110px]"
              value={sortOrder}
              onChange={onSortChange}
              ariaLabel="Sort bookmarks"
              buttonLeading={<ArrowDownAZ className="w-3.5 h-3.5 text-zinc-400" />}
              options={[
                { value: 'newest', label: 'Newest' },
                { value: 'oldest', label: 'Oldest' },
                { value: 'a-z', label: 'A-Z' },
                { value: 'z-a', label: 'Z-A' },
              ]}
            />
          )}

        {/* Layout Selector - only show in folder view */}
        {layoutScope && onLayoutColumnsChange && layoutColumns && viewMode === 'folder' && (
          <div className="hidden sm:flex items-center bg-zinc-100 p-0.5 rounded-lg border border-zinc-200/80">
            {[1, 2, 3, 4, 5].map((col) => (
              <button
                key={col}
                onClick={() => onLayoutColumnsChange(col as 1 | 2 | 3 | 4 | 5)}
                className={`p-1.5 rounded-md transition-all ${
                  layoutColumns === col ? 'bg-white shadow-sm text-zinc-900 ring-1 ring-zinc-200/60' : 'text-zinc-500 hover:text-zinc-800'
                }`}
                title={`${layoutScope === 'collection' ? 'Collection grid' : 'Bookmark layout'}: ${col} column${col > 1 ? 's' : ''}`}
              >
                <span className="text-[11px] font-semibold w-4 h-4 flex items-center justify-center">{col}</span>
              </button>
            ))}
          </div>
        )}

        {/* View Toggle */}
        {!hideViewToggle && (
        <div className="flex items-center bg-zinc-100 p-0.5 rounded-lg border border-zinc-200/80">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'grid' ? 'bg-white shadow-sm text-zinc-900 ring-1 ring-zinc-200/60' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Card Grid View"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('masonry')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'masonry' ? 'bg-white shadow-sm text-zinc-900 ring-1 ring-zinc-200/60' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Icon Grid View"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'list' ? 'bg-white shadow-sm text-zinc-900 ring-1 ring-zinc-200/60' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="List View"
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
          {allowFolderView && (
            <button
              onClick={() => onViewModeChange('folder')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'folder' ? 'bg-white shadow-sm text-zinc-900 ring-1 ring-zinc-200/60' : 'text-zinc-500 hover:text-zinc-800'
              }`}
              title="Folder View (group by collection)"
            >
              <FolderTree className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        )}

        {currentTabBookmarked && onEditCurrent ? (
          <button
            onClick={onEditCurrent}
            className="btn-brand-sm whitespace-nowrap"
          >
            <Edit className="w-4 h-4" /> Edit Bookmark
          </button>
        ) : (
          <button
            onClick={onAdd}
            className="btn-brand-sm whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        )}
      </div>
      </div>

      {hasActiveFilters && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-400">Filters</span>
          {searchQuery.trim() && (
            <button
              onClick={() => onSearchChange('')}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-brand-50 border border-brand-200 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors"
              title="Clear search"
            >
              <Search className="w-3 h-3 opacity-70" />
              <span className="max-w-[140px] truncate">{searchQuery.trim()}</span>
              <X className="w-3 h-3 ml-0.5 opacity-60 group-hover:opacity-100" />
            </button>
          )}
          {activeTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onRemoveTag?.(tag)}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-zinc-100 border border-zinc-200 text-[11px] font-medium text-zinc-700 hover:bg-zinc-200 transition-colors"
              title={`Remove ${tag} filter`}
            >
              <Hash className="w-3 h-3 opacity-70" />
              <span className="max-w-[140px] truncate">{tag}</span>
              <X className="w-3 h-3 ml-0.5 opacity-60 group-hover:opacity-100" />
            </button>
          ))}
          {onClearAllFilters && (searchQuery.trim() || activeTags.length > 1) && (
            <button
              onClick={onClearAllFilters}
              className="ml-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
