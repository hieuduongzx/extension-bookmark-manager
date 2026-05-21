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
  X,
  Maximize2,
  Edit2,
  Pin,
  ChevronRight,
  ChevronDown,
  Sparkles
} from 'lucide-react';
import type { Collection, CollectionIcon } from '../types';
import { COLLECTION } from '../types';
import { buildCollectionTree, flattenCollectionTree } from '../utils';

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
  activeTags?: string[];
  availableTags?: string[];
  onToggleTag?: (tag: string) => void;
  onOpenDashboard?: () => void;
  onEditCollection?: (id: string) => void;
  onTogglePinCollection?: (id: string) => void;
  enableAi?: boolean;
  onToggleAi?: () => void;
  onDropBookmark?: (bookmarkId: string, collectionId: string) => void;
  onDropCollection?: (draggedId: string, targetId: string | null) => void;
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
  if (isActive) return 'text-zinc-900';
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
    if (!stored) return { collections: false, tags: false };

    const parsed = JSON.parse(stored) as Partial<{ collections: boolean; tags: boolean }>;
    return {
      collections: Boolean(parsed.collections),
      tags: Boolean(parsed.tags),
    };
  } catch {
    return { collections: false, tags: false };
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
    <button
      draggable={isCustom}
      onDragStart={isCustom ? (e) => {
        e.dataTransfer.setData('application/collection-id', id);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      onClick={() => onSelect(id)}
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
      style={{ paddingLeft: `${12 + depth * 20}px` }}
      className={`group relative w-full flex items-center justify-between pr-3 h-[34px] rounded-md transition-colors duration-150 ease-out text-sm overflow-hidden ${
        isActive
          ? 'bg-zinc-100 text-zinc-900 font-medium'
          : 'text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900'
      } ${isDragOver ? 'ring-2 ring-blue-400 ring-inset bg-blue-50' : ''}`}
    >
      {isActive && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-blue-500" aria-hidden="true" />
      )}
      <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
        {isCustom && (
          <div
            className={`w-4 h-4 flex items-center justify-center shrink-0 rounded transition-colors pointer-events-auto ${
              hasChildren ? 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/80 cursor-pointer' : 'opacity-0'
            }`}
            onClick={(e) => {
              if (hasChildren && onToggleExpand) {
                e.stopPropagation();
                onToggleExpand();
              }
            }}
          >
            {hasChildren && (
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
            )}
          </div>
        )}
        <Icon className={`w-4 h-4 shrink-0 transition-colors duration-200 ${getColorClass(color, isActive)} ${!isCustom ? 'ml-1' : ''}`} />
        <span className="truncate transition-colors duration-200">{label}</span>
      </div>

      <div className="grid justify-items-end items-center shrink-0 ml-2 pointer-events-none">
        {isCustom && (
          <div className="col-start-1 row-start-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-0.5 group-hover:translate-y-0 pointer-events-auto z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePinCollection?.(id);
              }}
              className={`p-1 rounded transition-colors ${
                isPinned ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200'
              }`}
              title={isPinned ? 'Unpin Collection' : 'Pin Collection'}
            >
              <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditCollection?.(id);
              }}
              className="p-1 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200 rounded transition-colors"
              title="Edit Collection"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className={`col-start-1 row-start-1 flex items-center gap-1 transition-all duration-200 ${isCustom ? 'group-hover:opacity-0 group-hover:-translate-y-0.5' : ''}`}>
          {isCustom && isPinned && (
            <Pin className="w-3 h-3 fill-current text-blue-500" />
          )}
          <span
            className={`text-[11px] font-medium px-1.5 rounded-full transition-colors duration-150 min-w-[22px] h-[18px] inline-flex items-center justify-center tabular-nums ${
              isActive ? 'text-zinc-700 bg-white border border-zinc-200' : 'text-zinc-500 bg-zinc-100/60 group-hover:bg-zinc-200/80'
            }`}
          >
            {count}
          </span>
        </div>
      </div>
    </button>
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
      <div className="flex items-center justify-between px-3 mb-1.5">
        <button
          onClick={onToggleCollapsed}
          className="flex items-center gap-1 py-1 w-full text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-700 transition-colors"
          aria-expanded={!isCollapsed}
        >
          <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} />
          <span>Tags</span>
          {(activeTags.length > 0 || availableTags.length > 0) && (
            <span className="text-zinc-400 normal-case font-normal tracking-normal">
              ({activeTags.length + availableTags.length})
            </span>
          )}
        </button>
      </div>
      {!isCollapsed && (
        <div className="flex flex-col gap-2 px-3">
          {availableTags.length > 8 && (
            <div className="relative">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tags..."
                aria-label="Filter tags"
                className="w-full h-6 pl-2 pr-6 bg-zinc-50 border border-zinc-200 rounded text-[11px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 rounded"
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
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors border bg-blue-50 border-blue-200 text-blue-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 group"
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
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors border bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
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
              className="self-start text-[11px] text-blue-600 hover:text-blue-700 font-medium px-1"
            >
              Show {hiddenCount} more
            </button>
          )}
          {showAll && totalAvailable > TAGS_COLLAPSED_LIMIT && !filterLower && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="self-start text-[11px] text-zinc-500 hover:text-zinc-700 font-medium px-1"
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
  activeTags = [],
  availableTags = [],
  onToggleTag,
  onOpenDashboard,
  onEditCollection,
  onTogglePinCollection,
  enableAi = false,
  onToggleAi,
  onDropBookmark,
  onDropCollection
}: SidebarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [isCollectionsCollapsed, setIsCollectionsCollapsed] = useState(() => getStoredCollapseState().collections);
  const [isTagsCollapsed, setIsTagsCollapsed] = useState(() => getStoredCollapseState().tags);
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

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify({
      collections: isCollectionsCollapsed,
      tags: isTagsCollapsed,
    }));
  }, [isCollectionsCollapsed, isTagsCollapsed]);

  // Close settings menu when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const handleClick = () => setShowSettings(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [showSettings]);

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

  return (
    <div
      ref={sidebarRef}
      style={{ width: `${width}px` }}
      className="relative bg-white border-r border-zinc-200 flex flex-col h-full z-10 shrink-0"
    >
      <div className="p-4 border-b border-zinc-100 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-600 rounded-md flex items-center justify-center shadow-sm">
            <BookmarkIcon className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-[14px] font-semibold tracking-tight text-zinc-900">Bookmarks</h1>
        </div>
        {onOpenDashboard && (
          <button
            onClick={onOpenDashboard}
            className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors"
            title="Open Full Dashboard"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6">
        {/* Core items */}
        <div className="flex flex-col gap-0.5">
          <NavItem id={COLLECTION.UNSORTED} label="Unsorted" icon={Inbox} isActive={activeCollection === COLLECTION.UNSORTED} count={bookmarkCounts[COLLECTION.UNSORTED] || 0} onSelect={handleSelectCollection} />
          <NavItem id={COLLECTION.TRASH} label="Trash" icon={Trash2} isActive={activeCollection === COLLECTION.TRASH} count={bookmarkCounts[COLLECTION.TRASH] || 0} onSelect={handleSelectCollection} />
        </div>

        {/* Custom Collections */}
        <div>
          <div
            className="flex items-center justify-between px-3 mb-1.5 rounded-md transition-colors hover:bg-zinc-100/30"
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
              className="flex items-center gap-1 py-1 w-full text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider hover:text-zinc-700 transition-colors"
              aria-expanded={!isCollectionsCollapsed}
            >
              <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isCollectionsCollapsed ? '' : 'rotate-90'}`} />
              <span>Collections</span>
            </button>
            <button
              onClick={onNewCollection}
              className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors pointer-events-auto shrink-0"
              title="New Collection"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <NavItem
              id={COLLECTION.ALL}
              label="All Bookmarks"
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

        {/* Tags Section */}
        {(activeTags.length > 0 || availableTags.length > 0) && onToggleTag && (
          <TagsSection
            isCollapsed={isTagsCollapsed}
            onToggleCollapsed={() => setIsTagsCollapsed(prev => !prev)}
            activeTags={activeTags}
            availableTags={availableTags}
            onToggleTag={onToggleTag}
          />
        )}
      </div>

      {/* Footer Settings */}
      <div className="p-3 border-t border-zinc-100 shrink-0 relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
            showSettings ? 'bg-zinc-100 text-zinc-900 border border-zinc-200/50 shadow-sm' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/50'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </button>

        {showSettings && (
          <div className="absolute bottom-full left-3 mb-2 w-64 bg-white rounded-lg shadow-xl border border-zinc-200 py-2 z-50 text-[13px] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            {onToggleAi && (
              <div className="px-2 pb-2 border-b border-zinc-100 mb-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">AI</p>
                <label
                  className="w-full flex items-center justify-between gap-3 px-2 py-2 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md cursor-pointer transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="block font-medium truncate">AI Magic</span>
                      <span className="block text-[11px] leading-snug text-zinc-400">Auto-generate title, tags, and collection.</span>
                    </div>
                  </div>
                  <div className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${enableAi ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow shadow-black/10 transition-transform duration-200 ease-in-out ${enableAi ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </div>
                  <input
                    type="checkbox"
                    checked={enableAi}
                    onChange={onToggleAi}
                    className="sr-only"
                  />
                </label>
              </div>
            )}

            <div className="px-2 py-1">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Import</p>
              <button
                onClick={onImportJson}
                className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md transition-colors"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <span className="block font-medium truncate">Import JSON</span>
                  <span className="block text-[11px] leading-snug text-zinc-400">Restore from an exported file.</span>
                </div>
              </button>
              <button
                onClick={onImport}
                className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md transition-colors"
              >
                <Book className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <span className="block font-medium truncate">Import Browser Bookmarks</span>
                  <span className="block text-[11px] leading-snug text-zinc-400">Merge bookmarks from Chrome.</span>
                </div>
              </button>
            </div>

            {onExport && (
              <div className="px-2 py-1 border-t border-zinc-100 mt-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Export</p>
                <button
                  onClick={onExport}
                  className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md transition-colors"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <span className="block font-medium truncate">Export JSON</span>
                    <span className="block text-[11px] leading-snug text-zinc-400">Back up bookmarks and collections.</span>
                  </div>
                </button>
              </div>
            )}

            {onRefreshPreviews && (
              <div className="px-2 pt-1 border-t border-zinc-100 mt-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Maintenance</p>
                <button
                  onClick={onRefreshPreviews}
                  className="w-full flex items-center text-left gap-2.5 px-2 py-2 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-md transition-colors"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <span className="block font-medium truncate">Fetch Missing Previews</span>
                    <span className="block text-[11px] leading-snug text-zinc-400">Try loading cover images again.</span>
                  </div>
                </button>
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
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        onDoubleClick={handleResizeDoubleClick}
        className={`absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize group z-20 ${
          isResizing ? '' : ''
        }`}
        title="Drag to resize, double-click to reset"
      >
        <div
          className={`absolute top-0 right-0 h-full w-px transition-colors ${
            isResizing ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-400/60'
          }`}
        />
      </div>
    </div>
  );
};

function BookmarkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}
