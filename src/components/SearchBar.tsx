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
import { Button } from './ui/Button';
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

  useEffect(() => {
    if (!showMove && !showTag && !showOperators) return;
    const closeAll = () => {
      setShowMove(false);
      setShowTag(false);
      setShowOperators(false);
    };
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (!bulkActionsRef.current?.contains(node) && !filterPopRef.current?.contains(node)) {
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

  // ─── Bulk Select Mode Bar (*2k subtle accent tint + 1px bottom border) ──────
  if (isSelectMode || selectedCount > 0) {
    return (
      <div className="flex items-center justify-between gap-2 py-2.5 px-5 border-b border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] shrink-0 z-20 relative flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onSelectAll} className="!text-[var(--accent)]">
            {isAllSelected ? <CheckSquare size={15} /> : <Square size={15} />}
            <span>{isAllSelected ? t('deselectAll') : t('selectAll')}</span>
          </Button>
          <span className="text-[13px] font-semibold text-[var(--text)] tabular-nums">
            {selectedCount} {t('selected')}
          </span>
        </div>

        <div ref={bulkActionsRef} className="flex items-center gap-1.5 flex-wrap justify-end">
          {selectedCount > 0 && isTrashView && onBulkRestore && (
            <Button variant="primary" size="sm" onClick={onBulkRestore}>
              <RotateCcw size={13} /> {t('restoreSelected')}
            </Button>
          )}

          {selectedCount > 0 && !isTrashView && onBulkOpenTabs && (
            <Button variant="secondary" size="sm" onClick={onBulkOpenTabs}>
              <ExternalLink size={13} /> {t('openSelected')}
            </Button>
          )}

          {selectedCount > 0 && !isTrashView && onBulkMove && (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowMove((v) => !v);
                  setShowTag(false);
                }}
              >
                <FolderInput size={13} /> {t('moveTo')}
              </Button>
              {showMove && (
                <div className="absolute right-0 top-full mt-1 w-52 max-h-56 overflow-y-auto custom-scrollbar bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-pop z-30 p-1">
                  {moveOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[6px] truncate"
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowTag((v) => !v);
                  setShowMove(false);
                }}
              >
                <Tag size={13} /> {t('tags')}
              </Button>
              {showTag && (
                <div className="absolute right-0 top-full mt-1 w-60 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-pop z-30 p-2.5 space-y-2">
                  <div className="ui-segmented w-full grid grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setTagMode('add')}
                      className={`ui-segmented-btn ${tagMode === 'add' ? 'is-active' : ''}`}
                    >
                      {t('addTags')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTagMode('remove')}
                      className={`ui-segmented-btn ${tagMode === 'remove' ? 'is-active' : ''}`}
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
                    className="ui-input w-full"
                  />
                  <p className="text-[10.5px] text-[var(--text-muted)] m-0">
                    {t('pressEnterToApply')}
                  </p>
                </div>
              )}
            </div>
          )}

          {selectedCount > 0 && !isTrashView && onBulkPin && (
            <>
              <Button variant="secondary" size="sm" onClick={() => onBulkPin(true)}>
                <Pin size={13} /> {t('pin')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onBulkPin(false)}>
                {t('unpin')}
              </Button>
            </>
          )}

          {selectedCount > 0 && (
            <Button variant="danger" size="sm" onClick={onBulkDelete}>
              <Trash2 size={13} /> {isTrashView ? t('deletePermanently') : t('moveToTrash')}
            </Button>
          )}

          {onCancelSelectMode && (
            <Button variant="ghost" size="sm" onClick={onCancelSelectMode}>
              {t('cancel')}
            </Button>
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
    <div className="border-b border-[var(--border)] bg-[var(--surface)] shrink-0 z-20 relative">
      <div className="flex items-center justify-between gap-2.5 py-2.5 px-5">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {onSelectAll && !isSelectMode && onToggleSelectMode && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={onToggleSelectMode}
              title={t('selectMultiple')}
              aria-label={t('selectMultiple')}
            >
              <CheckSquare size={15} />
            </Button>
          )}

          <div ref={filterPopRef} className="relative flex-1 min-w-[160px] max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="ui-input w-full !pl-8 !pr-14 bg-[var(--surface-2)] focus:bg-[var(--surface)]"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] rounded"
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
                    ? 'bg-[rgba(59,130,246,0.14)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
                title={t('searchOperators')}
                aria-label={t('searchOperators')}
                aria-expanded={showOperators}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            {showOperators && (
              <div className="absolute left-0 top-full mt-1.5 w-72 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-pop z-30 p-2 animate-scale-in">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] px-2 pb-1.5 m-0">
                  {t('searchOperators')}
                </p>
                <div className="grid grid-cols-1 gap-0.5">
                  {searchOperators.map((op) => (
                    <button
                      key={op.token}
                      type="button"
                      onClick={() => insertOperator(op.token)}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-[6px] text-left hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <code className="text-[11.5px] font-mono font-semibold text-[var(--accent)]">
                        {op.token.trim()}
                      </code>
                      <span className="text-[11.5px] text-[var(--text-muted)] truncate">
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
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenCommandPalette}
              title={`${t('commandPalette')} (Ctrl/⌘+K)`}
              className="hidden md:inline-flex !px-2 !gap-1 font-mono !text-[11px] !text-[var(--text-muted)]"
            >
              <Command size={12} />
              <span>K</span>
            </Button>
          )}

          {onSortChange && (
            <Dropdown<SortOrder>
              size="sm"
              className="min-w-[136px]"
              value={sortOrder}
              onChange={onSortChange}
              ariaLabel="Sort bookmarks"
              buttonLeading={<ArrowDownAZ className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
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
            <div className="hidden sm:inline-flex ui-segmented !p-[2px]">
              {([1, 2, 3, 4, 5] as const).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => onLayoutColumnsChange(col)}
                  className={`ui-segmented-btn !h-[24px] !px-2 !text-[11px] tabular-nums ${
                    layoutColumns === col ? 'is-active' : ''
                  }`}
                  title={t('columnsCount', { n: String(col) })}
                  aria-label={t('columnsCount', { n: String(col) })}
                >
                  {col}
                </button>
              ))}
            </div>
          )}

          {!hideViewToggle && (
            <div className="ui-segmented !p-[2px]">
              <button
                type="button"
                onClick={() => onViewModeChange('grid')}
                className={`ui-segmented-btn !h-[26px] !px-2 ${viewMode === 'grid' ? 'is-active' : ''}`}
                title={t('viewGrid')}
                aria-label={t('viewGrid')}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('masonry')}
                className={`ui-segmented-btn !h-[26px] !px-2 ${viewMode === 'masonry' ? 'is-active' : ''}`}
                title={t('viewMasonry')}
                aria-label={t('viewMasonry')}
              >
                <LayoutDashboard size={14} />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('list')}
                className={`ui-segmented-btn !h-[26px] !px-2 ${viewMode === 'list' ? 'is-active' : ''}`}
                title={t('viewList')}
                aria-label={t('viewList')}
              >
                <LayoutList size={14} />
              </button>
              {allowFolderView && (
                <button
                  type="button"
                  onClick={() => onViewModeChange('folder')}
                  className={`ui-segmented-btn !h-[26px] !px-2 ${viewMode === 'folder' ? 'is-active' : ''}`}
                  title={t('viewFolder')}
                  aria-label={t('viewFolder')}
                >
                  <FolderTree size={14} />
                </button>
              )}
            </div>
          )}

          {currentTabBookmarked && onEditCurrent ? (
            <Button variant="primary" size="sm" onClick={onEditCurrent}>
              <Edit size={14} />
              <span>{t('editBookmark')}</span>
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onAdd}>
              <Plus size={14} />
              <span>{t('add')}</span>
            </Button>
          )}
        </div>
      </div>

      {hasActiveFilters && (
        <div className="px-5 pb-2.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--text-muted)] mr-0.5">
            {t('filters')}
          </span>
          {searchQuery.trim() && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-[rgba(59,130,246,0.12)] border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] text-[11px] font-medium text-[var(--accent)] hover:bg-[rgba(59,130,246,0.18)] transition-colors"
              title={t('clearSearch')}
            >
              <Search className="w-3 h-3 opacity-75" />
              <span className="max-w-[160px] truncate">{searchQuery.trim()}</span>
              <X className="w-3 h-3 ml-0.5 opacity-60 group-hover:opacity-100" />
            </button>
          )}
          {activeTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onRemoveTag?.(tag)}
              className="group inline-flex items-center gap-1 h-6 pl-2 pr-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-medium text-[var(--text)] hover:border-[var(--text-muted)] transition-colors"
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
              className="ml-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
