import { useEffect, useRef, useState } from 'react';
import {
  Search,
  Plus,
  LayoutGrid,
  LayoutList,
  CheckSquare,
  Square,
  Trash2,
  Edit,
  X,
  LayoutDashboard,
  Hash,
  FolderTree,
  ArrowDownAZ,
  FolderInput,
  Pin,
  Tag,
} from 'lucide-react';
import { Dropdown } from './Dropdown';
import type { Collection, SortOrder, ViewMode } from '../types';
import { COLLECTION } from '../types';
import { buildCollectionTree, flattenCollectionTree } from '../utils';
import type { LocaleCode } from '../types';
import { createT } from '../i18n';

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
  onBulkMove?: (collectionId: string) => void;
  onBulkTag?: (tags: string[]) => void;
  onBulkPin?: (pinned: boolean) => void;
  collections?: Collection[];
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
  locale?: LocaleCode;
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
  onBulkMove,
  onBulkTag,
  onBulkPin,
  collections = [],
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
  locale = 'en',
}: SearchBarProps) {
  const t = createT(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const bulkActionsRef = useRef<HTMLDivElement>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [showMove, setShowMove] = useState(false);
  const [showTag, setShowTag] = useState(false);

  // Dismiss the "Move to" / "Add tags" popovers on outside-click or Escape.
  useEffect(() => {
    if (!showMove && !showTag) return;
    const closeAll = () => {
      setShowMove(false);
      setShowTag(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!bulkActionsRef.current?.contains(e.target as Node)) closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showMove, showTag]);

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

  const moveOptions = [
    { value: COLLECTION.UNSORTED, label: t('unsorted') },
    ...flattenCollectionTree(buildCollectionTree(collections)).map((c) => ({
      value: c.id,
      label: `${'—'.repeat(c.depth)} ${c.name}`.trim(),
    })),
  ];

  if (isSelectMode || selectedCount > 0) {
    return (
      <div className="flex items-center justify-between gap-2 py-2.5 px-5 border-b border-brand-200 dark:border-brand-900 bg-brand-50/80 dark:bg-brand-950/40 shrink-0 z-10 relative flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={onSelectAll}
            className="flex items-center gap-2 px-2 py-1.5 text-brand-700 dark:text-brand-300 hover:bg-brand-100/50 dark:hover:bg-brand-900/40 rounded-md transition-colors font-medium text-[13px]"
          >
            {isAllSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {isAllSelected ? t('deselectAll') : t('selectAll')}
          </button>
          <span className="text-[13px] font-medium text-brand-900 dark:text-brand-100">
            {selectedCount} {t('selected')}
          </span>
        </div>
        <div ref={bulkActionsRef} className="flex items-center gap-1.5 flex-wrap justify-end">
          {selectedCount > 0 && !isTrashView && onBulkMove && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowMove((v) => !v);
                  setShowTag(false);
                }}
                className="flex items-center gap-1.5 px-2.5 h-8 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                <FolderInput className="w-3.5 h-3.5" /> {t('moveTo')}
              </button>
              {showMove && (
                <div className="absolute right-0 top-full mt-1 w-52 max-h-56 overflow-y-auto custom-scrollbar bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-pop z-30 py-1">
                  {moveOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-[12px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      onClick={() => {
                        onBulkMove(opt.value);
                        setShowMove(false);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {selectedCount > 0 && !isTrashView && onBulkTag && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowTag((v) => !v);
                  setShowMove(false);
                }}
                className="flex items-center gap-1.5 px-2.5 h-8 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                <Tag className="w-3.5 h-3.5" /> {t('addTags')}
              </button>
              {showTag && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-pop z-30 p-2">
                  <input
                    autoFocus
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const tags = tagDraft
                          .split(/[,\s]+/)
                          .map((x) => x.trim().toLowerCase().replace(/^#/, ''))
                          .filter(Boolean);
                        if (tags.length) {
                          onBulkTag(tags);
                          setTagDraft('');
                          setShowTag(false);
                        }
                      }
                    }}
                    placeholder="tag1, tag2"
                    className="brand-input-sm w-full dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
                  />
                  <p className="text-[10px] text-zinc-400 mt-1">Press Enter to apply</p>
                </div>
              )}
            </div>
          )}
          {selectedCount > 0 && !isTrashView && onBulkPin && (
            <>
              <button
                type="button"
                onClick={() => onBulkPin(true)}
                className="flex items-center gap-1.5 px-2.5 h-8 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                <Pin className="w-3.5 h-3.5" /> {t('pin')}
              </button>
              <button
                type="button"
                onClick={() => onBulkPin(false)}
                className="flex items-center gap-1.5 px-2.5 h-8 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                {t('unpin')}
              </button>
            </>
          )}
          {selectedCount > 0 && (
            <button
              onClick={onBulkDelete}
              className="flex items-center gap-1.5 px-3 h-8 bg-red-600 hover:bg-red-700 text-white rounded-md text-[13px] font-medium transition-colors shadow-sm"
            >
              <Trash2 className="w-4 h-4" /> {isTrashView ? t('deletePermanently') : t('moveToTrash')}
            </button>
          )}
          {onCancelSelectMode && (
            <button
              onClick={onCancelSelectMode}
              className="px-3 h-8 text-brand-700 dark:text-brand-300 hover:bg-brand-100/50 dark:hover:bg-brand-900/40 rounded-md text-[13px] font-medium transition-colors"
            >
              {t('cancel')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || activeTags.length > 0;

  return (
    <div className="border-b border-zinc-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 shrink-0 z-10 relative">
      <div className="flex items-center justify-between gap-3 py-3 px-5">
        <div className="flex flex-1 min-w-0 items-center gap-2.5">
          {onSelectAll && !isSelectMode && onToggleSelectMode && (
            <button
              onClick={onToggleSelectMode}
              title={t('selectMultiple')}
              className="btn-icon-sm shrink-0 dark:hover:bg-zinc-800"
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
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-transparent text-[13px] font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                title={t('clearSearch')}
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
              className="w-[120px]"
              value={sortOrder}
              onChange={onSortChange}
              ariaLabel="Sort bookmarks"
              buttonLeading={<ArrowDownAZ className="w-3.5 h-3.5 text-zinc-400" />}
              options={[
                { value: 'newest', label: t('newest') },
                { value: 'oldest', label: t('oldest') },
                { value: 'a-z', label: t('az') },
                { value: 'z-a', label: t('za') },
                { value: 'domain', label: t('domain') },
                { value: 'updated', label: t('updated') },
              ]}
            />
          )}

          {layoutScope && onLayoutColumnsChange && layoutColumns && viewMode === 'folder' && (
            <div className="hidden sm:flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/80 dark:border-zinc-700">
              {[1, 2, 3, 4, 5].map((col) => (
                <button
                  key={col}
                  onClick={() => onLayoutColumnsChange(col as 1 | 2 | 3 | 4 | 5)}
                  className={`p-1.5 rounded-md transition-all ${
                    layoutColumns === col
                      ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60 dark:ring-zinc-600'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                  title={`${col} columns`}
                >
                  <span className="text-[11px] font-semibold w-4 h-4 flex items-center justify-center">
                    {col}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!hideViewToggle && (
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/80 dark:border-zinc-700">
              <button
                onClick={() => onViewModeChange('grid')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                title="Card view"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onViewModeChange('masonry')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'masonry'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                title="Icon view"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onViewModeChange('list')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                title="List view"
              >
                <LayoutList className="w-3.5 h-3.5" />
              </button>
              {allowFolderView && (
                <button
                  onClick={() => onViewModeChange('folder')}
                  className={`p-1.5 rounded-md transition-all ${
                    viewMode === 'folder'
                      ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                  title="Folder View"
                >
                  <FolderTree className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {currentTabBookmarked && onEditCurrent ? (
            <button onClick={onEditCurrent} className="btn-brand-sm whitespace-nowrap">
              <Edit className="w-4 h-4" /> {t('editBookmark')}
            </button>
          ) : (
            <button onClick={onAdd} className="btn-brand-sm whitespace-nowrap">
              <Plus className="w-4 h-4" /> {t('add')}
            </button>
          )}
        </div>
      </div>

      {hasActiveFilters && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-400">{t('filters')}</span>
          {searchQuery.trim() && (
            <button
              onClick={() => onSearchChange('')}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-brand-50 dark:bg-brand-950 border border-brand-200 dark:border-brand-800 text-[11px] font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 transition-colors"
              title={t('clearSearch')}
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
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
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
              className="ml-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
