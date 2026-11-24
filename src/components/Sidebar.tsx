import { useState, useMemo, useEffect, memo, useCallback, useRef } from 'react';
import {
  Hash,
  Inbox,
  LayoutGrid,
  Settings,
  Trash2,
  Book,
  Plus,
  Download,
  Upload,
  Maximize2,
  Edit2,
  Pin,
  ChevronRight,
  X,
  ImageOff,
  Calendar,
  Link2Off,
  Tags,
  PanelRight,
  Cloud,
  CloudOff,
  Loader2,
  StickyNote,
  Copy,
  Sun,
  Moon,
  Monitor,
  Check,
  Pencil,
} from 'lucide-react';
import type { Collection, LocaleCode, ThemeMode } from '../types';
import { COLLECTION, SMART } from '../types';
import { buildCollectionTree, flattenCollectionTree } from '../utils';
import { createT } from '../i18n';
import { useEscapeKey } from '../hooks';
import type { GDriveUiStatus } from '../driveSync';
import { getCollectionColorText, getCollectionIcon } from '../collectionIcons';

interface SidebarProps {
  collections: Collection[];
  activeCollection: string;
  onSelectCollection: (id: string) => void;
  bookmarkCounts: Record<string, number>;
  tagCounts?: Record<string, number>;
  onNewCollection: () => void;
  onImport: () => void;
  onImportJson: () => void;
  onExport?: () => void;
  onOpenPreferences?: () => void;
  onOpenGDrive?: () => void;
  onSyncGDrive?: () => void;
  gdrive?: GDriveUiStatus | null;
  activeTags?: string[];
  availableTags?: string[];
  onToggleTag?: (tag: string) => void;
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tag: string) => void;
  onOpenDashboard?: () => void;
  onOpenSidePanel?: () => void;
  onEditCollection?: (id: string) => void;
  onTogglePinCollection?: (id: string) => void;
  onDropBookmark?: (bookmarkId: string, collectionId: string) => void;
  onDropCollection?: (draggedId: string, targetId: string | null) => void;
  theme?: ThemeMode;
  onCycleTheme?: () => void;
  locale?: LocaleCode;
}

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'bm-sidebar-collapse-state';
const SIDEBAR_WIDTH_STORAGE_KEY = 'bm-sidebar-width';
const SIDEBAR_MIN_WIDTH = 188;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_DEFAULT_WIDTH = 220;

const getStoredCollapseState = () => {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
    if (!stored) return { collections: false, tags: true, smart: false };

    const parsed = JSON.parse(stored) as Partial<{
      collections: boolean;
      tags: boolean;
      smart: boolean;
    }>;
    return {
      collections: Boolean(parsed.collections),
      tags: Boolean(parsed.tags),
      smart: parsed.smart ?? false,
    };
  } catch {
    return { collections: false, tags: true, smart: false };
  }
};

const getStoredSidebarWidth = (): number => {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return SIDEBAR_DEFAULT_WIDTH;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
};

// ─── Extracted NavItem ──────────────────────────────────────────────────────

interface NavItemProps {
  id: string;
  label: string;
  icon: React.ElementType;
  color?: string;
  depth?: number;
  isCustom?: boolean;
  hasChildren?: boolean;
  isExpanded?: boolean;
  isPinned?: boolean;
  isActive?: boolean;
  count?: number;
  onSelect: (id: string) => void;
  onToggleExpand?: () => void;
  onTogglePinCollection?: (id: string) => void;
  onEditCollection?: (id: string) => void;
  onDropBookmark?: (bookmarkId: string, collectionId: string) => void;
  onDropCollection?: (draggedId: string, targetId: string | null) => void;
  pinTitle?: string;
  unpinTitle?: string;
  editTitle?: string;
}

const NavItem = memo(
  ({
    id,
    label,
    icon: Icon,
    color = 'zinc',
    depth = 0,
    isCustom = false,
    hasChildren = false,
    isExpanded = false,
    isPinned = false,
    isActive = false,
    count = 0,
    onSelect,
    onToggleExpand,
    onTogglePinCollection,
    onEditCollection,
    onDropBookmark,
    onDropCollection,
    pinTitle = 'Pin Collection',
    unpinTitle = 'Unpin Collection',
    editTitle = 'Edit Collection',
  }: NavItemProps) => {
    const [isDragOver, setIsDragOver] = useState(false);

    return (
      <div
        draggable={isCustom}
        onDragStart={
          isCustom
            ? (e) => {
                e.dataTransfer.setData('application/collection-id', id);
                e.dataTransfer.effectAllowed = 'move';
              }
            : undefined
        }
        onDragOver={(e) => {
          const canDropBm =
            Boolean(onDropBookmark) && e.dataTransfer.types.includes('application/bookmark-id');
          const canDropCol =
            Boolean(onDropCollection) && e.dataTransfer.types.includes('application/collection-id');
          if (canDropBm || canDropCol) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!isDragOver) setIsDragOver(true);
          }
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          const bookmarkId = e.dataTransfer.getData('application/bookmark-id');
          if (bookmarkId && onDropBookmark) {
            onDropBookmark(bookmarkId, id);
          } else {
            const collectionId = e.dataTransfer.getData('application/collection-id');
            if (collectionId && onDropCollection) {
              onDropCollection(collectionId, isCustom ? id : null);
            }
          }
        }}
        className="group relative h-8"
      >
        <button
          type="button"
          onClick={() => onSelect(id)}
          aria-current={isActive ? 'page' : undefined}
          style={{ paddingLeft: `${isCustom ? 28 + depth * 16 : 10}px` }}
          className={`w-full h-full flex items-center justify-between rounded-lg pr-2 transition-colors duration-150 ease-out text-[13px] ${
            isActive
              ? 'bg-brand-50 text-brand-800 font-semibold dark:bg-brand-950/55 dark:text-brand-100'
              : 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-50'
          } ${isDragOver ? 'ring-2 ring-brand-400 ring-inset bg-brand-50 dark:bg-brand-950/40' : ''}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Icon
              className={`w-4 h-4 shrink-0 transition-colors duration-150 ${getCollectionColorText(
                color,
                isActive
              )} ${!isCustom ? 'ml-0.5' : ''}`}
            />
            <span className="truncate">{label}</span>
          </div>

          <div
            className={`flex items-center gap-1 transition-all duration-150 ${
              isCustom ? 'group-hover:opacity-0' : ''
            }`}
          >
            {isCustom && isPinned && <Pin className="w-3 h-3 fill-current text-brand-500" />}
            <span
              className={`text-[11px] font-semibold px-1.5 rounded-full transition-colors duration-150 min-w-[20px] h-[18px] inline-flex items-center justify-center tabular-nums ${
                isActive
                  ? 'text-brand-700 bg-brand-100/80 dark:text-brand-200 dark:bg-brand-900/50'
                  : 'text-zinc-500 bg-zinc-200/60 group-hover:bg-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:group-hover:bg-zinc-700'
              }`}
            >
              {count}
            </span>
          </div>
        </button>

        {isCustom && hasChildren && (
          <button
            type="button"
            onClick={() => onToggleExpand?.()}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={isExpanded}
            style={{ left: `${8 + depth * 16}px` }}
            className="absolute top-1.5 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-700 dark:hover:bg-zinc-700/80 dark:hover:text-zinc-200"
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          </button>
        )}

        {isCustom && (
          <div className="absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onTogglePinCollection?.(id)}
              className={`p-1 rounded transition-colors ${
                isPinned
                  ? 'text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:text-brand-300 dark:hover:bg-brand-950/50'
                  : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-zinc-100 dark:hover:bg-zinc-700'
              }`}
              title={isPinned ? unpinTitle : pinTitle}
            >
              <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => onEditCollection?.(id)}
              className="p-1 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
              title={editTitle}
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }
);

NavItem.displayName = 'NavItem';

// ─── Tags Section ──────────────────────────────────────────────────────────

interface TagsSectionProps {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  activeTags: string[];
  availableTags: string[];
  tagCounts?: Record<string, number>;
  onToggleTag: (tag: string) => void;
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tag: string) => void;
  locale: LocaleCode;
}

const TAGS_COLLAPSED_LIMIT = 12;

const TagsSection = memo(
  ({
    isCollapsed,
    onToggleCollapsed,
    activeTags,
    availableTags,
    tagCounts = {},
    onToggleTag,
    onRenameTag,
    onDeleteTag,
    locale,
  }: TagsSectionProps) => {
    const t = useMemo(() => createT(locale), [locale]);
    const [filter, setFilter] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [editingTag, setEditingTag] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');

    const filterLower = filter.trim().toLowerCase();
    const filteredAvailable = useMemo(() => {
      if (!filterLower) return availableTags;
      return availableTags.filter((tag) => tag.toLowerCase().includes(filterLower));
    }, [availableTags, filterLower]);

    const totalAvailable = filteredAvailable.length;
    const shownAvailable =
      showAll || filterLower ? filteredAvailable : filteredAvailable.slice(0, TAGS_COLLAPSED_LIMIT);
    const hiddenCount = totalAvailable - shownAvailable.length;

    const commitRename = () => {
      if (editingTag && renameDraft.trim() && onRenameTag) {
        onRenameTag(editingTag, renameDraft.trim());
      }
      setEditingTag(null);
      setRenameDraft('');
    };

    return (
      <div>
        <div className="flex items-center justify-between px-2 mb-1">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex items-center gap-1.5 py-1 w-full text-left text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
            aria-expanded={!isCollapsed}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                isCollapsed ? '' : 'rotate-90'
              }`}
            />
            <span>{t('tags')}</span>
            {(activeTags.length > 0 || availableTags.length > 0) && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium tabular-nums">
                {activeTags.length + availableTags.length}
              </span>
            )}
          </button>
        </div>

        {!isCollapsed && (
          <div className="flex flex-col gap-2 px-2">
            {availableTags.length > 8 && (
              <div className="relative">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('filterTagsPlaceholder')}
                  aria-label={t('filterTagsPlaceholder')}
                  className="w-full h-7 pl-2 pr-6 bg-white/80 border border-zinc-200 rounded-md text-[11px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-brand-500 focus:bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900 transition-colors"
                />
                {filter && (
                  <button
                    type="button"
                    onClick={() => setFilter('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                    aria-label={t('clearSearch')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {editingTag && (
              <div className="flex items-center gap-1 p-1 rounded-md bg-white dark:bg-zinc-900 border border-brand-400 shadow-sm">
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      setEditingTag(null);
                      setRenameDraft('');
                    }
                  }}
                  className="flex-1 min-w-0 bg-transparent text-[11.5px] px-1 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={commitRename}
                  className="p-1 text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/50 rounded"
                  aria-label={t('save')}
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTag(null);
                    setRenameDraft('');
                  }}
                  className="p-1 text-zinc-400 hover:text-zinc-700 rounded"
                  aria-label={t('cancel')}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {activeTags.map((tag) => (
                <button
                  key={`active-${tag}`}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors border bg-brand-50 border-brand-200 text-brand-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 dark:bg-brand-950/50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-red-950/40 dark:hover:border-red-900 dark:hover:text-red-400 group"
                >
                  <Hash className="w-3 h-3 opacity-70 group-hover:hidden" />
                  <X className="w-3 h-3 hidden group-hover:block" />
                  <span>{tag}</span>
                  {tagCounts[tag] ? (
                    <span className="text-[10px] opacity-65 tabular-nums">{tagCounts[tag]}</span>
                  ) : null}
                </button>
              ))}

              {shownAvailable.map((tag) => (
                <div
                  key={`avail-${tag}`}
                  className="group/tag inline-flex items-center rounded-md border bg-white/80 border-zinc-200/90 hover:border-zinc-300 dark:bg-zinc-900/60 dark:border-zinc-700/80 dark:hover:border-zinc-600 transition-colors overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => onToggleTag(tag)}
                    className="flex items-center gap-1 pl-2 pr-1.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    <Hash className="w-2.5 h-2.5 opacity-60" />
                    <span>{tag}</span>
                    {tagCounts[tag] ? (
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {tagCounts[tag]}
                      </span>
                    ) : null}
                  </button>
                  {(onRenameTag || onDeleteTag) && (
                    <span className="hidden group-hover/tag:inline-flex items-center pr-1 gap-0.5 border-l border-zinc-200/70 dark:border-zinc-700/70 pl-0.5">
                      {onRenameTag && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTag(tag);
                            setRenameDraft(tag);
                          }}
                          className="p-0.5 text-zinc-400 hover:text-brand-600 dark:hover:text-brand-400 rounded"
                          title={t('renameTag')}
                          aria-label={t('renameTag')}
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      )}
                      {onDeleteTag && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTag(tag);
                          }}
                          className="p-0.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                          title={t('deleteTag')}
                          aria-label={t('deleteTag')}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {hiddenCount > 0 && !showAll && !filterLower && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="self-start text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium px-1"
              >
                {t('showMoreTags', { n: String(hiddenCount) })}
              </button>
            )}
            {showAll && totalAvailable > TAGS_COLLAPSED_LIMIT && !filterLower && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="self-start text-[11px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium px-1"
              >
                {t('showLessTags')}
              </button>
            )}
            {filterLower && totalAvailable === 0 && (
              <p className="text-[11px] text-zinc-400 italic px-1">{t('noMatchingTags')}</p>
            )}
          </div>
        )}
      </div>
    );
  }
);

TagsSection.displayName = 'TagsSection';

// ─── Main Component ─────────────────────────────────────────────────────────

export function Sidebar({
  collections,
  activeCollection,
  onSelectCollection,
  bookmarkCounts,
  tagCounts,
  onNewCollection,
  onImport,
  onImportJson,
  onExport,
  onOpenPreferences,
  onOpenGDrive,
  onSyncGDrive,
  gdrive = null,
  activeTags = [],
  availableTags = [],
  onToggleTag,
  onRenameTag,
  onDeleteTag,
  onOpenDashboard,
  onOpenSidePanel,
  onEditCollection,
  onTogglePinCollection,
  onDropBookmark,
  onDropCollection,
  theme = 'system',
  onCycleTheme,
  locale = 'en',
}: SidebarProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [showSettings, setShowSettings] = useState(false);
  const [isCollectionsCollapsed, setIsCollectionsCollapsed] = useState(
    () => getStoredCollapseState().collections
  );
  const [isTagsCollapsed, setIsTagsCollapsed] = useState(() => getStoredCollapseState().tags);
  const [isSmartCollapsed, setIsSmartCollapsed] = useState(() => getStoredCollapseState().smart);
  const [width, setWidth] = useState<number>(() => getStoredSidebarWidth());
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (e: MouseEvent) => {
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX - left));
      setWidth(next);
    };
    const stop = () => setIsResizing(false);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', stop);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', stop);
    };
  }, [isResizing]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // ignore storage errors
    }
  }, [width]);

  const handleResizeDoubleClick = useCallback(() => {
    setWidth(SIDEBAR_DEFAULT_WIDTH);
  }, []);

  const adjustWidth = useCallback((delta: number) => {
    setWidth((w) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w + delta)));
  }, []);

  useEffect(() => {
    localStorage.setItem(
      SIDEBAR_COLLAPSE_STORAGE_KEY,
      JSON.stringify({
        collections: isCollectionsCollapsed,
        tags: isTagsCollapsed,
        smart: isSmartCollapsed,
      })
    );
  }, [isCollectionsCollapsed, isTagsCollapsed, isSmartCollapsed]);

  useEffect(() => {
    if (!showSettings) return;
    const handleClick = () => setShowSettings(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [showSettings]);

  useEscapeKey(() => setShowSettings(false), showSettings);

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [isRootDragOver, setIsRootDragOver] = useState(false);

  useEffect(() => {
    let currentId: string | undefined = activeCollection;
    const toExpand = new Set<string>();

    if (currentId) toExpand.add(currentId);

    while (currentId) {
      const coll = collections.find((c) => c.id === currentId);
      if (!coll || !coll.parentId) break;
      toExpand.add(coll.parentId);
      currentId = coll.parentId;
      if (toExpand.has(currentId)) break;
    }

    if (toExpand.size > 0) {
      setManualExpanded((prev) => {
        let changed = false;
        for (const id of toExpand) {
          if (!prev.has(id)) changed = true;
        }
        if (!changed) return prev;
        const next = new Set(prev);
        toExpand.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [activeCollection, collections]);

  const toggleExpand = useCallback((id: string) => {
    setManualExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const flatTree = useMemo(() => {
    return flattenCollectionTree(buildCollectionTree(collections));
  }, [collections]);

  const visibleCollections = useMemo(() => {
    return flatTree.filter((c) => {
      let currentId = c.parentId;
      while (currentId) {
        if (!manualExpanded.has(currentId)) return false;
        const parentColl = collections.find((p) => p.id === currentId);
        currentId = parentColl?.parentId;
      }
      return true;
    });
  }, [flatTree, collections, manualExpanded]);

  const handleSelectCollection = useCallback(
    (id: string) => {
      onSelectCollection(id);
    },
    [onSelectCollection]
  );

  const isSmartViewActive =
    activeCollection === SMART.PINNED ||
    activeCollection === SMART.UNTAGGED ||
    activeCollection === SMART.WITH_NOTES ||
    activeCollection === SMART.NO_COVER ||
    activeCollection === SMART.THIS_WEEK ||
    activeCollection === SMART.BROKEN ||
    activeCollection === SMART.DUPLICATES;
  const isSmartExpanded = !isSmartCollapsed || isSmartViewActive;

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeModeLabel =
    theme === 'dark' ? t('themeDark') : theme === 'light' ? t('themeLight') : t('themeSystem');

  return (
    <div
      ref={sidebarRef}
      style={{ width: `${width}px` }}
      className="relative bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200/80 dark:border-zinc-800 flex flex-col h-full z-20 shrink-0 select-none"
    >
      {/* Header */}
      <div className="px-3.5 py-3 shrink-0 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={chrome.runtime.getURL('public/icons/icon-128.png')}
            alt="Bookmark Manager"
            className="w-6 h-6 rounded-md shrink-0"
          />
          <h1 className="text-[13.5px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50 truncate">
            {t('appName')}
          </h1>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onOpenSidePanel && (
            <button
              type="button"
              onClick={onOpenSidePanel}
              className="btn-icon-sm dark:hover:bg-zinc-800"
              title={t('openSidePanel')}
              aria-label={t('openSidePanel')}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          )}
          {onOpenDashboard && (
            <button
              type="button"
              onClick={onOpenDashboard}
              className="btn-icon-sm dark:hover:bg-zinc-800"
              title={t('openDashboard')}
              aria-label={t('openDashboard')}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Nav */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2.5 py-3 space-y-4">
        {/* Collections */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/collection-id')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const collectionId = e.dataTransfer.getData('application/collection-id');
            if (collectionId && onDropCollection) {
              onDropCollection(collectionId, null);
            }
          }}
        >
          <div
            className={`flex items-center justify-between px-2 py-0.5 mb-1 rounded-md transition-colors ${
              isRootDragOver
                ? 'ring-2 ring-brand-400 ring-inset bg-brand-50 dark:bg-brand-950/40'
                : 'hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60'
            }`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/collection-id')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!isRootDragOver) setIsRootDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsRootDragOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsRootDragOver(false);
              const collectionId = e.dataTransfer.getData('application/collection-id');
              if (collectionId && onDropCollection) {
                onDropCollection(collectionId, null);
              }
            }}
          >
            <button
              type="button"
              onClick={() => setIsCollectionsCollapsed((prev) => !prev)}
              className="flex items-center gap-1.5 py-1 w-full text-left text-[12px] font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              aria-expanded={!isCollectionsCollapsed}
            >
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  isCollectionsCollapsed ? '' : 'rotate-90'
                }`}
              />
              <span>{t('collections')}</span>
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 tabular-nums">
                {collections.length}
              </span>
            </button>
            <button
              type="button"
              onClick={onNewCollection}
              className="p-1 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white dark:hover:bg-zinc-800 transition-colors shrink-0"
              title={t('newCollection')}
              aria-label={t('newCollection')}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {isRootDragOver && (
            <p className="px-2 pb-1 text-[11px] font-medium text-brand-600 dark:text-brand-400">
              {t('dropToRoot')}
            </p>
          )}

          <div className="flex flex-col gap-0.5">
            <NavItem
              id={COLLECTION.ALL}
              label={t('allBookmarks')}
              icon={LayoutGrid}
              isActive={activeCollection === COLLECTION.ALL}
              count={bookmarkCounts[COLLECTION.ALL] || 0}
              onSelect={handleSelectCollection}
            />
            {!isCollectionsCollapsed &&
              visibleCollections.map((c) => {
                const isExpanded = manualExpanded.has(c.id);
                const hasChildren = c.children && c.children.length > 0;
                return (
                  <NavItem
                    key={c.id}
                    id={c.id}
                    label={c.name}
                    icon={getCollectionIcon(c.icon)}
                    color={c.color}
                    depth={c.depth}
                    isCustom={true}
                    hasChildren={hasChildren}
                    isExpanded={isExpanded}
                    isPinned={Boolean(c.pinned)}
                    isActive={activeCollection === c.id}
                    count={bookmarkCounts[c.id] || 0}
                    onSelect={handleSelectCollection}
                    onToggleExpand={() => toggleExpand(c.id)}
                    onTogglePinCollection={onTogglePinCollection}
                    onEditCollection={onEditCollection}
                    onDropBookmark={onDropBookmark}
                    onDropCollection={onDropCollection}
                    pinTitle={t('pinCollection')}
                    unpinTitle={t('unpinCollection')}
                    editTitle={t('editCollection')}
                  />
                );
              })}
          </div>
        </div>

        {/* Tags */}
        {(activeTags.length > 0 || availableTags.length > 0) && onToggleTag && (
          <TagsSection
            isCollapsed={isTagsCollapsed}
            onToggleCollapsed={() => setIsTagsCollapsed((prev) => !prev)}
            activeTags={activeTags}
            availableTags={availableTags}
            tagCounts={tagCounts}
            onToggleTag={onToggleTag}
            onRenameTag={onRenameTag}
            onDeleteTag={onDeleteTag}
            locale={locale}
          />
        )}

        {/* Utility Views */}
        <div className="flex flex-col gap-0.5 pt-2.5 border-t border-zinc-200/80 dark:border-zinc-800">
          <NavItem
            id={COLLECTION.UNSORTED}
            label={t('unsorted')}
            icon={Inbox}
            isActive={activeCollection === COLLECTION.UNSORTED}
            count={bookmarkCounts[COLLECTION.UNSORTED] || 0}
            onSelect={handleSelectCollection}
            onDropBookmark={onDropBookmark}
          />
          <NavItem
            id={COLLECTION.TRASH}
            label={t('trash')}
            icon={Trash2}
            isActive={activeCollection === COLLECTION.TRASH}
            count={bookmarkCounts[COLLECTION.TRASH] || 0}
            onSelect={handleSelectCollection}
            onDropBookmark={onDropBookmark}
          />
        </div>

        {/* Smart Collections */}
        <div>
          <button
            type="button"
            onClick={() => setIsSmartCollapsed((prev) => !prev)}
            className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50 rounded-md dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
            aria-expanded={isSmartExpanded}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                isSmartExpanded ? 'rotate-90' : ''
              }`}
            />
            <span>{t('smart')}</span>
          </button>
          {isSmartExpanded && (
            <div className="flex flex-col gap-0.5 mt-1">
              <NavItem
                id={SMART.PINNED}
                label={t('smartPinned')}
                icon={Pin}
                isActive={activeCollection === SMART.PINNED}
                count={bookmarkCounts[SMART.PINNED] || 0}
                onSelect={handleSelectCollection}
              />
              <NavItem
                id={SMART.WITH_NOTES}
                label={t('smartWithNotes')}
                icon={StickyNote}
                isActive={activeCollection === SMART.WITH_NOTES}
                count={bookmarkCounts[SMART.WITH_NOTES] || 0}
                onSelect={handleSelectCollection}
              />
              <NavItem
                id={SMART.UNTAGGED}
                label={t('smartUntagged')}
                icon={Tags}
                isActive={activeCollection === SMART.UNTAGGED}
                count={bookmarkCounts[SMART.UNTAGGED] || 0}
                onSelect={handleSelectCollection}
              />
              <NavItem
                id={SMART.THIS_WEEK}
                label={t('smartThisWeek')}
                icon={Calendar}
                isActive={activeCollection === SMART.THIS_WEEK}
                count={bookmarkCounts[SMART.THIS_WEEK] || 0}
                onSelect={handleSelectCollection}
              />
              <NavItem
                id={SMART.NO_COVER}
                label={t('smartNoCover')}
                icon={ImageOff}
                isActive={activeCollection === SMART.NO_COVER}
                count={bookmarkCounts[SMART.NO_COVER] || 0}
                onSelect={handleSelectCollection}
              />
              <NavItem
                id={SMART.BROKEN}
                label={t('smartBroken')}
                icon={Link2Off}
                color={bookmarkCounts[SMART.BROKEN] ? 'rose' : 'zinc'}
                isActive={activeCollection === SMART.BROKEN}
                count={bookmarkCounts[SMART.BROKEN] || 0}
                onSelect={handleSelectCollection}
              />
              {(bookmarkCounts[SMART.DUPLICATES] || 0) > 0 || activeCollection === SMART.DUPLICATES ? (
                <NavItem
                  id={SMART.DUPLICATES}
                  label={t('smartDuplicates')}
                  icon={Copy}
                  color="orange"
                  isActive={activeCollection === SMART.DUPLICATES}
                  count={bookmarkCounts[SMART.DUPLICATES] || 0}
                  onSelect={handleSelectCollection}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Footer: Settings + Quick Theme Toggle */}
      <div className="px-2.5 py-2 border-t border-zinc-200/80 dark:border-zinc-800 shrink-0 relative flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
          }}
          className={`flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-[13px] font-medium ${
            showSettings
              ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/80 dark:border-zinc-700'
              : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/70'
          }`}
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span className="truncate">{t('settings')}</span>
          {gdrive?.connected && (
            <span
              className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${
                gdrive.needsReauth ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              title={gdrive.needsReauth ? t('gdriveStatusNeedsReauth') : t('gdriveStatusSynced')}
            />
          )}
        </button>

        {onCycleTheme && (
          <button
            type="button"
            onClick={onCycleTheme}
            className="btn-icon-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            title={t('switchTheme', { mode: themeModeLabel })}
            aria-label={t('switchTheme', { mode: themeModeLabel })}
          >
            <ThemeIcon className="w-4 h-4" />
          </button>
        )}

        {showSettings && (
          <div className="absolute bottom-full left-2.5 mb-1.5 w-64 bg-white dark:bg-zinc-900 rounded-xl shadow-pop border border-zinc-200 dark:border-zinc-700 py-1.5 z-50 text-[13px] overflow-hidden animate-slide-up">
            {(onOpenGDrive || onSyncGDrive) && (
              <div className="px-2 py-1 border-b border-zinc-100 dark:border-zinc-800 mb-1">
                <p className="px-2 pb-1 text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                  <Cloud className="w-3 h-3" />
                  {t('gdriveSection')}
                </p>
                <button
                  type="button"
                  disabled={gdrive?.busy}
                  onClick={() => {
                    setShowSettings(false);
                    if (gdrive?.connected && onSyncGDrive) onSyncGDrive();
                    else if (onOpenGDrive) onOpenGDrive();
                    else onSyncGDrive?.();
                  }}
                  className="w-full flex items-center text-left gap-2.5 px-2 py-2 rounded-lg transition-colors text-zinc-700 dark:text-zinc-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-60"
                >
                  {gdrive?.busy ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin text-brand-600" />
                  ) : gdrive?.connected ? (
                    <Cloud className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-400" />
                  ) : (
                    <CloudOff className="w-4 h-4 shrink-0 text-zinc-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{t('gdriveMenuTitle')}</span>
                    <span className="block text-[11px] leading-snug text-zinc-400 truncate">
                      {gdrive?.busy
                        ? t('gdriveSyncing')
                        : gdrive?.needsReauth
                          ? t('gdriveStatusNeedsReauth')
                          : gdrive?.connected
                          ? gdrive.email
                            ? `${t('gdriveConnectedAs')} ${gdrive.email}`
                            : t('gdriveStatusSynced')
                          : t('gdriveMenuHint')}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 shrink-0">
                    {gdrive?.needsReauth
                      ? t('gdriveReconnect')
                      : gdrive?.connected
                        ? t('gdriveMenuSync')
                        : t('gdriveMenuConnect')}
                  </span>
                </button>
                {onOpenPreferences && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      onOpenGDrive ? onOpenGDrive() : onOpenPreferences();
                    }}
                    className="w-full text-left px-2 py-1 text-[11px] text-zinc-400 hover:text-brand-600 dark:hover:text-brand-400"
                  >
                    {t('gdriveSection')} → {t('preferences')}
                  </button>
                )}
              </div>
            )}

            {onOpenPreferences && (
              <div className="px-2 py-1 border-b border-zinc-100 dark:border-zinc-800 mb-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false);
                    onOpenPreferences();
                  }}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  <span className="font-medium truncate">{t('preferences')}</span>
                </button>
              </div>
            )}

            <div className="px-2 py-1">
              <button
                type="button"
                onClick={onImportJson}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span className="font-medium truncate">{t('importJson')}</span>
              </button>
              <button
                type="button"
                onClick={onImport}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
              >
                <Book className="w-4 h-4 shrink-0" />
                <span className="font-medium truncate">{t('importBrowser')}</span>
              </button>
              {onExport && (
                <button
                  type="button"
                  onClick={onExport}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="font-medium truncate">{t('exportJson')}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        aria-valuenow={Math.round(width)}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        onDoubleClick={handleResizeDoubleClick}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            adjustWidth(-16);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            adjustWidth(16);
          } else if (e.key === 'Home') {
            e.preventDefault();
            setWidth(SIDEBAR_DEFAULT_WIDTH);
          }
        }}
        className="absolute top-0 right-0 h-full w-2 -mr-1 cursor-col-resize group z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        title="Drag to resize, double-click to reset"
      >
        <div
          className={`absolute top-0 right-1 h-full w-px transition-colors ${
            isResizing ? 'bg-brand-500' : 'bg-transparent group-hover:bg-brand-400/60'
          }`}
        />
      </div>
    </div>
  );
}
