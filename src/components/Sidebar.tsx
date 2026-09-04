import { useState, useMemo, useEffect, memo, useCallback, useRef } from 'react';
import {
  Folder,
  Hash,
  Inbox,
  LayoutGrid,
  Settings,
  Star,
  Trash2,
  Briefcase,
  Book,
  Code,
  Music,
  Film,
  ShoppingCart,
  Globe,
  Heart,
  Plus,
  Download,
  Upload,
  RefreshCw,
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
} from 'lucide-react';
import type { Collection, CollectionIcon, LocaleCode } from '../types';
import { COLLECTION, SMART } from '../types';
import { buildCollectionTree, flattenCollectionTree } from '../utils';
import { createT } from '../i18n';
import { useEscapeKey } from '../hooks';
import type { GDriveUiStatus } from '../gdrive';

interface SidebarProps {
  collections: Collection[];
  activeCollection: string;
  onSelectCollection: (id: string) => void;
  bookmarkCounts: Record<string, number>;
  onNewCollection: () => void;
  onImport: () => void;
  onImportJson: () => void;
  onExport?: () => void;
  onRefreshPreviews?: () => void;
  onCheckBroken?: () => void;
  onOpenPreferences?: () => void;
  /** Open preferences focused on Google Drive / run sync-connect flow */
  onOpenGDrive?: () => void;
  onSyncGDrive?: () => void;
  gdrive?: GDriveUiStatus | null;
  activeTags?: string[];
  availableTags?: string[];
  onToggleTag?: (tag: string) => void;
  onOpenDashboard?: () => void;
  onOpenSidePanel?: () => void;
  onEditCollection?: (id: string) => void;
  onTogglePinCollection?: (id: string) => void;
  onDropBookmark?: (bookmarkId: string, collectionId: string) => void;
  onDropCollection?: (draggedId: string, targetId: string | null) => void;
  locale?: LocaleCode;
}

const getIcon = (iconName: CollectionIcon) => {
  switch (iconName) {
    case 'folder': return Folder;
    case 'star': return Star;
    case 'heart': return Heart;
    case 'briefcase': return Briefcase;
    case 'book': return Book;
    case 'code': return Code;
    case 'music': return Music;
    case 'film': return Film;
    case 'shopping-cart': return ShoppingCart;
    case 'globe': return Globe;
    default: return Folder;
  }
};

const getColorClass = (colorName: string, isActive: boolean) => {
  if (isActive) return 'text-brand-700 dark:text-brand-300';
  switch (colorName) {
    case 'blue': return 'text-blue-500';
    case 'indigo': return 'text-indigo-500';
    case 'violet': return 'text-violet-500';
    case 'rose': return 'text-rose-500';
    case 'orange': return 'text-orange-500';
    case 'amber': return 'text-amber-500';
    case 'emerald': return 'text-emerald-500';
    case 'teal': return 'text-teal-500';
    case 'cyan': return 'text-cyan-500';
    case 'pink': return 'text-pink-500';
    default: return 'text-zinc-500';
  }
};

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'bm-sidebar-collapse-state';
const SIDEBAR_WIDTH_STORAGE_KEY = 'bm-sidebar-width';
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 208;

const getStoredCollapseState = () => {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
    if (!stored) return { collections: false, tags: true, smart: true };

    const parsed = JSON.parse(stored) as Partial<{ collections: boolean; tags: boolean; smart: boolean }>;
    return {
      collections: Boolean(parsed.collections),
      tags: Boolean(parsed.tags),
      // Smart views are secondary navigation, so keep them compact by default.
      smart: parsed.smart ?? true,
    };
  } catch {
    return { collections: false, tags: true, smart: true };
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
}

const NavItem = memo(({
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
}: NavItemProps) => {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      draggable={isCustom}
      onDragStart={isCustom ? (e) => {
        e.dataTransfer.setData('application/collection-id', id);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/bookmark-id') ||
            e.dataTransfer.types.includes('application/collection-id')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!isDragOver) setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
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
        style={{ paddingLeft: `${isCustom ? 30 + depth * 20 : 12}px` }}
        className={`w-full h-full flex items-center justify-between rounded-md pr-2.5 transition-colors duration-150 ease-out text-[13px] ${
        isActive
          ? 'bg-brand-50 text-brand-800 font-semibold dark:bg-brand-950/55 dark:text-brand-100'
          : 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-50'
      } ${isDragOver ? 'ring-2 ring-brand-400 ring-inset bg-brand-50 dark:bg-brand-950/40' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 transition-colors duration-200 ${getColorClass(color, isActive)} ${!isCustom ? 'ml-1' : ''}`} />
        <span className="truncate transition-colors duration-200">{label}</span>
      </div>

        <div className={`flex items-center gap-1 transition-all duration-200 ${isCustom ? 'group-hover:opacity-0 group-hover:-translate-y-0.5' : ''}`}>
          {isCustom && isPinned && (
            <Pin className="w-3 h-3 fill-current text-brand-500" />
          )}
          <span
            className={`text-[11px] font-semibold px-1.5 rounded-full transition-colors duration-150 min-w-[22px] h-[18px] inline-flex items-center justify-center tabular-nums ${
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
          style={{ left: `${10 + depth * 20}px` }}
          className="absolute top-1.5 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-700 dark:hover:bg-zinc-700/80 dark:hover:text-zinc-200"
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
      )}

      {isCustom && (
        <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onTogglePinCollection?.(id)}
            className={`p-1 rounded transition-colors ${
              isPinned
                ? 'text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:text-brand-300 dark:hover:bg-brand-950/50'
                : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-zinc-100 dark:hover:bg-zinc-700'
            }`}
            title={isPinned ? 'Unpin Collection' : 'Pin Collection'}
          >
            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onEditCollection?.(id)}
            className="p-1 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200 dark:hover:text-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
            title="Edit Collection"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

NavItem.displayName = 'NavItem';

// ─── Tags Section ──────────────────────────────────────────────────────────

interface TagsSectionProps {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  activeTags: string[];
  availableTags: string[];
  onToggleTag: (tag: string) => void;
}

const TAGS_COLLAPSED_LIMIT = 12;

const TagsSection = memo(({
  isCollapsed,
  onToggleCollapsed,
  activeTags,
  availableTags,
  onToggleTag,
}: TagsSectionProps) => {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filterLower = filter.trim().toLowerCase();
  const filteredAvailable = useMemo(() => {
    if (!filterLower) return availableTags;
    return availableTags.filter((t) => t.toLowerCase().includes(filterLower));
  }, [availableTags, filterLower]);

  const totalAvailable = filteredAvailable.length;
  const shownAvailable = showAll || filterLower ? filteredAvailable : filteredAvailable.slice(0, TAGS_COLLAPSED_LIMIT);
  const hiddenCount = totalAvailable - shownAvailable.length;

  return (
    <div>
      <div className="flex items-center justify-between px-2.5 mb-1">
        <button
          onClick={onToggleCollapsed}
          className="flex items-center gap-1.5 py-1.5 w-full text-left text-[12px] font-semibold text-zinc-600 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
          aria-expanded={!isCollapsed}
        >
          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} />
          <span>Tags</span>
          {(activeTags.length > 0 || availableTags.length > 0) && (
            <span className="text-zinc-400 font-normal">
              ({activeTags.length + availableTags.length})
            </span>
          )}
        </button>
      </div>
      {!isCollapsed && (
        <div className="flex flex-col gap-2 px-2.5">
          {availableTags.length > 8 && (
            <div className="relative">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tags..."
                aria-label="Filter tags"
                className="w-full h-6 pl-2 pr-6 bg-zinc-50 border border-zinc-200 rounded text-[11px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-brand-500 focus:bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900 transition-colors"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                  aria-label="Clear tag filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {activeTags.map(tag => (
              <button
                key={`active-${tag}`}
                onClick={() => onToggleTag(tag)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors border bg-brand-50 border-brand-200 text-brand-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 dark:bg-brand-950/50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-red-950/40 dark:hover:border-red-900 dark:hover:text-red-400 group"
                title="Remove tag filter"
              >
                <Hash className="w-3 h-3 opacity-70 group-hover:hidden" />
                <X className="w-3 h-3 hidden group-hover:block" />
                {tag}
              </button>
            ))}
            {shownAvailable.map(tag => (
              <button
                key={`avail-${tag}`}
                onClick={() => onToggleTag(tag)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors border bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-zinc-800/60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                title="Filter by this tag"
              >
                <Hash className="w-3 h-3 opacity-70" />
                {tag}
              </button>
            ))}
          </div>
          {hiddenCount > 0 && !showAll && !filterLower && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="self-start text-[11px] text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium px-1"
            >
              Show {hiddenCount} more
            </button>
          )}
          {showAll && totalAvailable > TAGS_COLLAPSED_LIMIT && !filterLower && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="self-start text-[11px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 font-medium px-1"
            >
              Show less
            </button>
          )}
          {filterLower && totalAvailable === 0 && (
            <p className="text-[11px] text-zinc-400 italic px-1">No matching tags</p>
          )}
        </div>
      )}
    </div>
  );
});

TagsSection.displayName = 'TagsSection';

// ─── Main Component ─────────────────────────────────────────────────────────

export function Sidebar({
  collections,
  activeCollection,
  onSelectCollection,
  bookmarkCounts,
  onNewCollection,
  onImport,
  onImportJson,
  onExport,
  onRefreshPreviews,
  onCheckBroken,
  onOpenPreferences,
  onOpenGDrive,
  onSyncGDrive,
  gdrive = null,
  activeTags = [],
  availableTags = [],
  onToggleTag,
  onOpenDashboard,
  onOpenSidePanel,
  onEditCollection,
  onTogglePinCollection,
  onDropBookmark,
  onDropCollection,
  locale = 'en',
}: SidebarProps) {
  const t = createT(locale);
  const [showSettings, setShowSettings] = useState(false);
  const [isCollectionsCollapsed, setIsCollectionsCollapsed] = useState(() => getStoredCollapseState().collections);
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
    localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify({
      collections: isCollectionsCollapsed,
      tags: isTagsCollapsed,
      smart: isSmartCollapsed,
    }));
  }, [isCollectionsCollapsed, isTagsCollapsed, isSmartCollapsed]);

  // Close settings menu when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const handleClick = () => setShowSettings(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [showSettings]);

  // …and on Escape (top-most dismissible layer wins).
  useEscapeKey(() => setShowSettings(false), showSettings);

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());

  // Auto-expand activeCollection and its ancestors
  useEffect(() => {
    let currentId: string | undefined = activeCollection;
    const toExpand = new Set<string>();

    if (currentId) toExpand.add(currentId);

    while (currentId) {
      const coll = collections.find(c => c.id === currentId);
      if (!coll || !coll.parentId) break;
      toExpand.add(coll.parentId);
      currentId = coll.parentId;
      if (toExpand.has(currentId)) break;
    }

    if (toExpand.size > 0) {
      setManualExpanded(prev => {
        let changed = false;
        for (const id of toExpand) {
          if (!prev.has(id)) changed = true;
        }
        if (!changed) return prev;
        const next = new Set(prev);
        toExpand.forEach(id => next.add(id));
        return next;
      });
    }
  }, [activeCollection, collections]);

  const toggleExpand = useCallback((id: string) => {
    setManualExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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
        const parentColl = collections.find(p => p.id === currentId);
        currentId = parentColl?.parentId;
      }
      return true;
    });
  }, [flatTree, collections, manualExpanded]);

  const handleSelectCollection = useCallback((id: string) => {
    onSelectCollection(id);
  }, [onSelectCollection]);

  const isSmartViewActive = activeCollection === SMART.PINNED ||
    activeCollection === SMART.UNTAGGED ||
    activeCollection === SMART.NO_COVER ||
    activeCollection === SMART.THIS_WEEK ||
    activeCollection === SMART.BROKEN;
  const isSmartExpanded = !isSmartCollapsed || isSmartViewActive;

  return (
    <div
      ref={sidebarRef}
      style={{ width: `${width}px` }}
      className="relative bg-zinc-100/70 dark:bg-zinc-950 border-r border-zinc-200/80 dark:border-zinc-800 flex flex-col h-full z-10 shrink-0"
    >
      <div className="px-3.5 py-3 shrink-0 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <img
            src={chrome.runtime.getURL("public/icons/icon-128.png")}
            alt="Bookmark Manager"
            className="w-6 h-6 rounded-md"
          />
          <h1 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{t('appName')}</h1>
        </div>
        <div className="flex items-center gap-0.5">
          {onOpenSidePanel && (
            <button
              onClick={onOpenSidePanel}
              className="btn-icon-sm dark:hover:bg-zinc-800"
              title={t('openSidePanel')}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          )}
          {onOpenDashboard && (
            <button
              onClick={onOpenDashboard}
              className="btn-icon-sm dark:hover:bg-zinc-800"
              title={t('openDashboard')}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2.5 py-3 space-y-4">
        {/* Collections are the primary navigation, deliberately first. */}
        <div>
          <div
            className="flex items-center justify-between px-2.5 mb-1 rounded-md transition-colors hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const collectionId = e.dataTransfer.getData('application/collection-id');
              if (collectionId && onDropCollection) {
                onDropCollection(collectionId, null);
              }
            }}
          >
            <button
              onClick={() => setIsCollectionsCollapsed(prev => !prev)}
              className="flex items-center gap-1.5 py-1.5 w-full text-left text-[12px] font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              aria-expanded={!isCollectionsCollapsed}
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isCollectionsCollapsed ? '' : 'rotate-90'}`} />
              <span>{t('collections')}</span>
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{collections.length}</span>
            </button>
            <button
              onClick={onNewCollection}
              className="p-1 rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white dark:hover:bg-zinc-800 transition-colors pointer-events-auto shrink-0"
              title="New Collection"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <NavItem
              id={COLLECTION.ALL}
              label={t('allBookmarks')}
              icon={LayoutGrid}
              isActive={activeCollection === COLLECTION.ALL}
              count={bookmarkCounts[COLLECTION.ALL] || 0}
              onSelect={handleSelectCollection}
            />
            {!isCollectionsCollapsed && visibleCollections.map((c) => {
              const isExpanded = manualExpanded.has(c.id);
              const hasChildren = c.children && c.children.length > 0;
              return (
                <NavItem
                  key={c.id}
                  id={c.id}
                  label={c.name}
                  icon={getIcon(c.icon)}
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
                />
              );
            })}
          </div>
        </div>

        {(activeTags.length > 0 || availableTags.length > 0) && onToggleTag && (
          <TagsSection
            isCollapsed={isTagsCollapsed}
            onToggleCollapsed={() => setIsTagsCollapsed(prev => !prev)}
            activeTags={activeTags}
            availableTags={availableTags}
            onToggleTag={onToggleTag}
          />
        )}

        {/* Utility views stay available without competing with collections. */}
        <div className="flex flex-col gap-0.5 pt-2 border-t border-zinc-200/80 dark:border-zinc-800">
          <NavItem id={COLLECTION.UNSORTED} label={t('unsorted')} icon={Inbox} isActive={activeCollection === COLLECTION.UNSORTED} count={bookmarkCounts[COLLECTION.UNSORTED] || 0} onSelect={handleSelectCollection} />
          <NavItem id={COLLECTION.TRASH} label={t('trash')} icon={Trash2} isActive={activeCollection === COLLECTION.TRASH} count={bookmarkCounts[COLLECTION.TRASH] || 0} onSelect={handleSelectCollection} />
        </div>

        {/* Smart views are secondary and collapse by default to preserve vertical space. */}
        <div>
          <button
            type="button"
            onClick={() => setIsSmartCollapsed(prev => !prev)}
            className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60 rounded-md dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
            aria-expanded={isSmartExpanded}
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isSmartExpanded ? 'rotate-90' : ''}`} />
            <span>{t('smart')}</span>
          </button>
          {isSmartExpanded && (
            <div className="flex flex-col gap-0.5 mt-1">
              <NavItem id={SMART.PINNED} label={t('smartPinned')} icon={Pin} isActive={activeCollection === SMART.PINNED} count={bookmarkCounts[SMART.PINNED] || 0} onSelect={handleSelectCollection} />
              <NavItem id={SMART.UNTAGGED} label={t('smartUntagged')} icon={Tags} isActive={activeCollection === SMART.UNTAGGED} count={bookmarkCounts[SMART.UNTAGGED] || 0} onSelect={handleSelectCollection} />
              <NavItem id={SMART.NO_COVER} label={t('smartNoCover')} icon={ImageOff} isActive={activeCollection === SMART.NO_COVER} count={bookmarkCounts[SMART.NO_COVER] || 0} onSelect={handleSelectCollection} />
              <NavItem id={SMART.THIS_WEEK} label={t('smartThisWeek')} icon={Calendar} isActive={activeCollection === SMART.THIS_WEEK} count={bookmarkCounts[SMART.THIS_WEEK] || 0} onSelect={handleSelectCollection} />
              <NavItem id={SMART.BROKEN} label={t('smartBroken')} icon={Link2Off} isActive={activeCollection === SMART.BROKEN} count={bookmarkCounts[SMART.BROKEN] || 0} onSelect={handleSelectCollection} />
            </div>
          )}
        </div>
      </div>

      {/* Footer Settings */}
      <div className="px-3 py-2.5 border-t border-zinc-200/60 dark:border-zinc-700/60 shrink-0 relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-[13px] font-medium ${
            showSettings
              ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/60 dark:border-zinc-600'
              : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-white/70 dark:hover:bg-zinc-800/70'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>{t('settings')}</span>
        </button>

        {showSettings && (
          <div className="absolute bottom-full left-3 mb-1.5 w-64 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 py-1.5 z-50 text-[13px] overflow-hidden animate-slide-up">
            {/* Google Drive — first so users always see sync */}
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
                    if (gdrive?.connected && onSyncGDrive) {
                      onSyncGDrive();
                    } else if (onOpenGDrive) {
                      onOpenGDrive();
                    } else {
                      onSyncGDrive?.();
                    }
                  }}
                  className="w-full flex items-center text-left gap-2.5 px-2 py-2 rounded-md transition-colors text-zinc-700 dark:text-zinc-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-60"
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
                        : gdrive?.connected
                          ? gdrive.email
                            ? `${t('gdriveConnectedAs')} ${gdrive.email}`
                            : t('gdriveStatusSynced')
                          : t('gdriveMenuHint')}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 shrink-0">
                    {gdrive?.connected ? t('gdriveMenuSync') : t('gdriveMenuConnect')}
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
                  onClick={() => {
                    setShowSettings(false);
                    onOpenPreferences();
                  }}
                  className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
                >
                  <Settings className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <span className="block font-medium truncate">{t('preferences')}</span>
                    <span className="block text-[11px] leading-snug text-zinc-400">Theme, language, trash…</span>
                  </div>
                </button>
              </div>
            )}
            <div className="px-2 py-1">
              <p className="px-2 pb-1 text-[11px] font-semibold text-zinc-400">Import</p>
              <button
                onClick={onImportJson}
                className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <span className="block font-medium truncate">{t('importJson')}</span>
                  <span className="block text-[11px] leading-snug text-zinc-400">Restore from an exported file.</span>
                </div>
              </button>
              <button
                onClick={onImport}
                className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
              >
                <Book className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <span className="block font-medium truncate">{t('importBrowser')}</span>
                  <span className="block text-[11px] leading-snug text-zinc-400">Folders become collections.</span>
                </div>
              </button>
            </div>

            {onExport && (
              <div className="px-2 py-1 border-t border-zinc-100 dark:border-zinc-800 mt-1">
                <p className="px-2 pb-1 text-[11px] font-semibold text-zinc-400">Export</p>
                <button
                  onClick={onExport}
                  className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <span className="block font-medium truncate">{t('exportJson')}</span>
                    <span className="block text-[11px] leading-snug text-zinc-400">Back up bookmarks and collections.</span>
                  </div>
                </button>
              </div>
            )}

            {(onRefreshPreviews || onCheckBroken) && (
              <div className="px-2 pt-1 border-t border-zinc-100 dark:border-zinc-800 mt-1">
                <p className="px-2 pb-1 text-[11px] font-semibold text-zinc-400">Maintenance</p>
                {onRefreshPreviews && (
                  <button
                    onClick={onRefreshPreviews}
                    className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <span className="block font-medium truncate">{t('fetchPreviews')}</span>
                      <span className="block text-[11px] leading-snug text-zinc-400">Try loading cover images again.</span>
                    </div>
                  </button>
                )}
                {onCheckBroken && (
                  <button
                    onClick={onCheckBroken}
                    className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-md transition-colors"
                  >
                    <Link2Off className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <span className="block font-medium truncate">{t('checkBroken')}</span>
                      <span className="block text-[11px] leading-snug text-zinc-400">Probe HTTP status of links.</span>
                    </div>
                  </button>
                )}
              </div>
            )}
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
        title="Drag to resize, double-click to reset (arrow keys when focused)"
      >
        <div
          className={`absolute top-0 right-1 h-full w-px transition-colors ${
            isResizing ? 'bg-brand-500' : 'bg-transparent group-hover:bg-brand-400/50'
          }`}
        />
      </div>
    </div>
  );
};
