import { useEffect, useMemo, useRef, useState } from 'react';
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
  RotateCcw,
  ExternalLink,
  SlidersHorizontal,
  Command,
} from 'lucide-react';
import { Dropdown } from './Dropdown';
import type { Collection, LocaleCode, SortOrder, ViewMode } from '../types';
import { COLLECTION } from '../types';
import { buildCollectionTree, flattenCollectionTree } from '../utils';
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
  onOpenCommandPalette?: () => void;
  selectedCount?: number;
  isAllSelected?: boolean;
  onSelectAll?: () => void;
  onBulkDelete?: () => void;
  onBulkRestore?: () => void;
  onBulkOpenTabs?: () => void;
  onBulkMove?: (collectionId: string) => void;
  onBulkTag?: (tags: string[], mode?: 'add' | 'remove') => void;
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
  onOpenCommandPalette,
  selectedCount = 0,
  isAllSelected = false,
  onSelectAll,
  onBulkDelete,
  onBulkRestore,
  onBulkOpenTabs,
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
  const t = useMemo(() => createT(locale), [locale]);
  const inputRef = useRef<HTMLInputElement>(null);
  const bulkActionsRef = useRef<HTMLDivElement>(null);
  const filterPopRef = useRef<HTMLDivElement>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add');
  const [showMove, setShowMove] = useState(false);
  const [showTag, setShowTag] = useState(false);
  const [showOperators, setShowOperators] = useState(false);

  // Dismiss popovers on outside-click or Escape.
  useEffect(() => {
    if (!showMove && !showTag && !showOperators) return;
    const closeAll = () => {
      setShowMove(false);
      setShowTag(false);
      setShowOperators(false);
    };
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (
        !bulkActionsRef.current?.contains(node) &&
        !filterPopRef.current?.contains(node)
      ) {
        closeAll();
      }
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
  }, [showMove, showTag, showOperators]);

  useEffect(() => {
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

  const moveOptions = useMemo(
    () => [
      { value: COLLECTION.UNSORTED, label: t('unsorted') },
      ...flattenCollectionTree(buildCollectionTree(collections)).map((c) => ({
        value: c.id,
        label: `${'—'.repeat(c.depth)} ${c.name}`.trim(),
      })),
    ],
    [collections, t]
  );

  const searchOperators = useMemo(
    () => [
      { token: 'tag:', desc: t('opTagDesc') },
      { token: '-tag:', desc: t('opExcludeTagDesc') },
      { token: 'site:', desc: t('opSiteDesc') },
      { token: 'in:', desc: t('opInDesc') },
      { token: 'note:', desc: t('opNoteDesc') },
      { token: 'is:pinned ', desc: t('opPinnedDesc') },
      { token: 'has:note ', desc: t('opHasNoteDesc') },
      { token: 'is:broken ', desc: t('opBrokenDesc') },
    ],
    [t]
  );

  const insertOperator = (token: string) => {
    const prefix = searchQuery.trim() ? `${searchQuery.trim()} ` : '';
    onSearchChange(`${prefix}${token}`);
    setShowOperators(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // ─── Bulk Select Mode Bar ───────────────────────────────────────────────────
  if (isSelectMode || selectedCount > 0) {
    return (
      <div className="flex items-center justify-between gap-2 py-2.5 px-5 border-b border-brand-200 dark:border-brand-900 bg-brand-50/80 dark:bg-brand-950/40 shrink-0 z-20 relative flex-wrap">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSelectAll}
            className="flex items-center gap-2 px-2 py-1.5 text-brand-700 dark:text-brand-300 hover:bg-brand-100/60 dark:hover:bg-brand-900/40 rounded-md transition-colors font-medium text-[13px]"
          >
            {isAllSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {isAllSelected ? t('deselectAll') : t('selectAll')}
          </button>
          <span className="text-[13px] font-semibold text-brand-900 dark:text-brand-100 tabular-nums">
            {selectedCount} {t('selected')}
          </span>
        </div>

        <div ref={bulkActionsRef} className="flex items-center gap-1.5 flex-wrap justify-end">
          {selectedCount > 0 && isTrashView && onBulkRestore && (
            <button
              type="button"
              onClick={onBulkRestore}
              className="flex items-center gap-1.5 px-2.5 h-8 bg-brand-600 hover:bg-brand-700 text-white rounded-md text-[12px] font-medium shadow-sm transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> {t('restoreSelected')}
            </button>
          )}

          {selectedCount > 0 && !isTrashView && onBulkOpenTabs && (
            <button
              type="button"
              onClick={onBulkOpenTabs}
              className="flex items-center gap-1.5 px-2.5 h-8 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              <ExternalLink className="w-3.5 h-3.5" /> {t('openSelected')}
            </button>
          )}

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
                      className="w-full text-left px-3 py-1.5 text-[12px] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 truncate"
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
                <Tag className="w-3.5 h-3.5" /> {t('tags')}
              </button>
              {showTag && (
                <div className="absolute right-0 top-full mt-1 w-60 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-pop z-30 p-2.5 space-y-2">
                  <div className="flex bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-md">
                    <button
                      type="button"
                      onClick={() => setTagMode('add')}
                      className={`flex-1 py-1 text-[11px] font-semibold rounded transition-colors ${
                        tagMode === 'add'
                          ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {t('addTags')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTagMode('remove')}
                      className={`flex-1 py-1 text-[11px] font-semibold rounded transition-colors ${
                        tagMode === 'remove'
                          ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {t('removeTags')}
                    </button>
                  </div>
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
                          onBulkTag(tags, tagMode);
                          setTagDraft('');
                          setShowTag(false);
                        }
                      }
                    }}
                    placeholder="tag1, tag2"
                    className="brand-input-sm w-full dark:bg-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
                  />
                  <p className="text-[10.5px] text-zinc-400">{t('pressEnterToApply')}</p>
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
              type="button"
              onClick={onBulkDelete}
              className="flex items-center gap-1.5 px-3 h-8 bg-red-600 hover:bg-red-700 text-white rounded-md text-[12.5px] font-medium transition-colors shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />{' '}
              {isTrashView ? t('deletePermanently') : t('moveToTrash')}
            </button>
          )}

          {onCancelSelectMode && (
            <button
              type="button"
              onClick={onCancelSelectMode}
              className="px-2.5 h-8 text-brand-700 dark:text-brand-300 hover:bg-brand-100/60 dark:hover:bg-brand-900/40 rounded-md text-[12.5px] font-medium transition-colors"
            >
              {t('cancel')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || activeTags.length > 0;
  const showColumnPicker =
    Boolean(layoutScope && onLayoutColumnsChange && layoutColumns) &&
    (viewMode === 'folder' || viewMode === 'grid');

  return (
    <div className="border-b border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0 z-20 relative">
      <div className="flex items-center justify-between gap-2.5 py-2.5 px-5">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {onSelectAll && !isSelectMode && onToggleSelectMode && (
            <button
              type="button"
              onClick={onToggleSelectMode}
              title={t('selectMultiple')}
              aria-label={t('selectMultiple')}
              className="btn-icon-sm shrink-0 dark:hover:bg-zinc-800"
            >
              <CheckSquare className="w-4 h-4" />
            </button>
          )}

          <div ref={filterPopRef} className="relative flex-1 min-w-[140px] max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="w-full h-9 pl-9 pr-14 rounded-lg bg-zinc-100/90 dark:bg-zinc-800 border border-transparent text-[13px] font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                  title={t('clearSearch')}
                  aria-label={t('clearSearch')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowOperators((v) => !v)}
                className={`p-1 rounded transition-colors ${
                  showOperators
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
                title={t('searchOperators')}
                aria-label={t('searchOperators')}
                aria-expanded={showOperators}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            {showOperators && (
              <div className="absolute left-0 top-full mt-1.5 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-pop z-30 p-2.5 animate-scale-in">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1.5 pb-1.5">
                  {t('searchOperators')}
                </p>
                <div className="grid grid-cols-1 gap-0.5">
                  {searchOperators.map((op) => (
                    <button
                      key={op.token}
                      type="button"
                      onClick={() => insertOperator(op.token)}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <code className="text-[11.5px] font-mono font-semibold text-brand-600 dark:text-brand-400">
                        {op.token.trim()}
                      </code>
                      <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400 truncate">
                        {op.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title={`${t('commandPalette')} (Ctrl/⌘+K)`}
              className="hidden md:inline-flex items-center gap-1 h-8 px-2 rounded-md border border-zinc-200/80 dark:border-zinc-700 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800/70 dark:hover:bg-zinc-800 text-[11px] font-mono font-medium text-zinc-500 dark:text-zinc-400 transition-colors"
            >
              <Command className="w-3 h-3" />
              <span>K</span>
            </button>
          )}

          {onSortChange && (
            <Dropdown<SortOrder>
              size="sm"
              className="w-[116px]"
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

          {showColumnPicker && onLayoutColumnsChange && layoutColumns && (
            <div className="hidden sm:flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/80 dark:border-zinc-700">
              {([1, 2, 3, 4, 5] as const).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => onLayoutColumnsChange(col)}
                  className={`p-1 rounded-md transition-all ${
                    layoutColumns === col
                      ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60 dark:ring-zinc-600'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                  title={t('columnsCount', { n: String(col) })}
                  aria-label={t('columnsCount', { n: String(col) })}
                >
                  <span className="text-[11px] font-semibold w-4 h-4 flex items-center justify-center tabular-nums">
                    {col}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!hideViewToggle && (
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/80 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => onViewModeChange('grid')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60 dark:ring-zinc-600'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                title={t('viewGrid')}
                aria-label={t('viewGrid')}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('masonry')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'masonry'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60 dark:ring-zinc-600'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                title={t('viewMasonry')}
                aria-label={t('viewMasonry')}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('list')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60 dark:ring-zinc-600'
                    : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
                title={t('viewList')}
                aria-label={t('viewList')}
              >
                <LayoutList className="w-3.5 h-3.5" />
              </button>
              {allowFolderView && (
                <button
                  type="button"
                  onClick={() => onViewModeChange('folder')}
                  className={`p-1.5 rounded-md transition-all ${
                    viewMode === 'folder'
                      ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50 ring-1 ring-zinc-200/60 dark:ring-zinc-600'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                  title={t('viewFolder')}
                  aria-label={t('viewFolder')}
                >
                  <FolderTree className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {currentTabBookmarked && onEditCurrent ? (
            <button type="button" onClick={onEditCurrent} className="btn-brand-sm whitespace-nowrap">
              <Edit className="w-4 h-4" /> {t('editBookmark')}
            </button>
          ) : (
            <button type="button" onClick={onAdd} className="btn-brand-sm whitespace-nowrap">
              <Plus className="w-4 h-4" /> {t('add')}
            </button>
          )}
        </div>
      </div>

      {hasActiveFilters && (
        <div className="px-5 pb-2.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-400 mr-0.5">{t('filters')}</span>
          {searchQuery.trim() && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-brand-50 dark:bg-brand-950 border border-brand-200 dark:border-brand-800 text-[11px] font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 transition-colors"
              title={t('clearSearch')}
            >
              <Search className="w-3 h-3 opacity-70" />
              <span className="max-w-[160px] truncate">{searchQuery.trim()}</span>
              <X className="w-3 h-3 ml-0.5 opacity-60 group-hover:opacity-100" />
            </button>
          )}
          {activeTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onRemoveTag?.(tag)}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              <Hash className="w-3 h-3 opacity-70" />
              <span className="max-w-[140px] truncate">{tag}</span>
              <X className="w-3 h-3 ml-0.5 opacity-60 group-hover:opacity-100" />
            </button>
          ))}
          {onClearAllFilters && (searchQuery.trim() || activeTags.length > 1) && (
            <button
              type="button"
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
