import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense, useTransition } from 'react';
import { Sidebar } from './components/Sidebar';
import { SearchBar } from './components/SearchBar';
import { BookmarkList } from './components/BookmarkList';
import { FolderView } from './components/FolderView';
import { QuickSave } from './components/QuickSave';
import { SidebarSkeleton, SearchBarSkeleton, BookmarkListSkeleton, ModalSkeleton, QuickSaveSkeleton } from './components/Skeletons';
import {
  COLLECTION,
  DEFAULT_SETTINGS,
  SMART,
  isSmartCollection,
  type Bookmark,
  type Collection,
  type CollectionColor,
  type CollectionIcon,
  type AppState,
  type AppSettings,
  type Message,
  type SortOrder,
  type ViewMode,
} from './types';
import {
  applyTheme,
  buildDescendantsMap,
  filterBySmartCollection,
  findBookmarkByUrl,
  getDomain,
  matchesSearch,
  parseSearchQuery,
} from './utils';
import { useDebouncedValue, useToastQueue } from './hooks';
import { createT, setLocale } from './i18n';
import { STORAGE_KEYS } from './storage';
import type { GDriveStatus, GDriveUiStatus } from './gdrive';

const AddBookmarkModal = lazy(() =>
  import('./components/AddBookmarkModal').then((m) => ({ default: m.AddBookmarkModal }))
);
const CollectionModal = lazy(() =>
  import('./components/CollectionModal').then((m) => ({ default: m.CollectionModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);

type ColumnCount = 1 | 2 | 3 | 4 | 5;

/** Parse a stored column count, falling back when the value is missing/NaN/out of range. */
function parseColumns(raw: string | null, fallback: ColumnCount): ColumnCount {
  const n = raw != null ? parseInt(raw, 10) : NaN;
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 ? n : fallback;
}

function useExtensionState() {
  const [state, setState] = useState<AppState>({
    bookmarks: [],
    collections: [],
    settings: { ...DEFAULT_SETTINGS },
  });
  const [isLoaded, setIsLoaded] = useState(false);

  const applyResponse = useCallback((response: AppState | undefined) => {
    if (!response || (response as { error?: string }).error) return;
    setState({
      bookmarks: response.bookmarks ?? [],
      collections: response.collections ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(response.settings || {}) },
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'BM:getState' } satisfies Message, (response) => {
      if (response && !response.error) {
        applyResponse(response);
      } else {
        console.error('Failed to load state', response?.error);
      }
      setIsLoaded(true);
    });
  }, [applyResponse]);

  // Multi-window / multi-view sync
  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (
        changes[STORAGE_KEYS.bookmarks] ||
        changes[STORAGE_KEYS.collections] ||
        changes[STORAGE_KEYS.settings]
      ) {
        chrome.runtime.sendMessage({ type: 'BM:getState' } satisfies Message, (response) => {
          if (response && !response.error) applyResponse(response);
        });
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [applyResponse]);

  const send = useCallback(
    (msg: Message): Promise<AppState> => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.error) {
            reject(new Error(response.error));
            return;
          }
          if (response && !response.error) {
            applyResponse(response);
            resolve(response as AppState);
            return;
          }
          reject(new Error('No response from background service'));
        });
      });
    },
    [applyResponse]
  );

  return { state, send, isLoaded, setState };
}

function App() {
  const { state, send, isLoaded } = useExtensionState();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const isDashboard = params.get('target') === 'dashboard';
  const isLibrary = params.get('view') === 'library';
  const initialQ = params.get('q') || '';

  const [activeCollection, setActiveCollection] = useState<string>(COLLECTION.ALL);
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 120);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [showPrefs, setShowPrefs] = useState(false);
  const [forceLibrary, setForceLibrary] = useState(isLibrary);
  const [autoGdriveConnect, setAutoGdriveConnect] = useState(
    () => params.get('gdrive') === 'connect'
  );
  const [prefsFocusGDrive, setPrefsFocusGDrive] = useState(
    () => params.get('gdrive') === 'connect'
  );
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveBusy, setGdriveBusy] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('bm_viewMode') as ViewMode | null;
    if (saved === 'grid' || saved === 'list' || saved === 'masonry' || saved === 'folder') {
      return saved;
    }
    // List is the default view.
    return 'list';
  });

  const showQuickSave =
    !isDashboard && !forceLibrary && state.settings.showQuickSave !== false;

  useEffect(() => {
    applyTheme(state.settings.theme);
    setLocale(state.settings.locale);
  }, [state.settings.theme, state.settings.locale]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (state.settings.theme === 'system') applyTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [state.settings.theme]);

  useEffect(() => {
    if (state.settings.defaultSort) setSortOrder(state.settings.defaultSort);
  }, [state.settings.defaultSort]);

  // Seed the view mode from the user's saved default the first time state loads,
  // unless a per-device localStorage override already exists.
  const didSeedViewMode = useRef(false);
  useEffect(() => {
    if (!isLoaded || didSeedViewMode.current) return;
    didSeedViewMode.current = true;
    if (!localStorage.getItem('bm_viewMode') && state.settings.defaultViewMode) {
      setViewMode(state.settings.defaultViewMode);
    }
  }, [isLoaded, state.settings.defaultViewMode]);

  // Deep-link from popup: open Settings and start Drive connect on Dashboard
  useEffect(() => {
    if (!isLoaded || !autoGdriveConnect || !isDashboard) return;
    setForceLibrary(true);
    setShowPrefs(true);
    setPrefsFocusGDrive(true);
  }, [isLoaded, autoGdriveConnect, isDashboard]);

  const refreshGDriveStatus = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'BM:gdriveStatus' } satisfies Message, (response) => {
      if (chrome.runtime.lastError || response?.error) return;
      setGdriveStatus(response as GDriveStatus);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    refreshGDriveStatus();
  }, [isLoaded, refreshGDriveStatus]);

  const gdriveUi: GDriveUiStatus | null = useMemo(() => {
    if (!gdriveStatus) {
      return { connected: false, email: null, lastSyncAt: null, busy: gdriveBusy };
    }
    return {
      connected: gdriveStatus.connected,
      email: gdriveStatus.email,
      lastSyncAt: gdriveStatus.lastSyncAt,
      busy: gdriveBusy,
    };
  }, [gdriveStatus, gdriveBusy]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('bm_viewMode', mode);
  }, []);

  const [bookmarkColumns, setBookmarkColumns] = useState<1 | 2 | 3 | 4 | 5>(() =>
    parseColumns(localStorage.getItem('bm_bookmarkColumns'), 1)
  );

  const handleBookmarkColumnsChange = useCallback((c: 1 | 2 | 3 | 4 | 5) => {
    setBookmarkColumns(c);
    localStorage.setItem('bm_bookmarkColumns', String(c));
  }, []);

  const [collectionColumns, setCollectionColumns] = useState<1 | 2 | 3 | 4 | 5>(() =>
    parseColumns(localStorage.getItem('bm_collectionColumns'), 3)
  );

  const handleCollectionColumnsChange = useCallback((c: 1 | 2 | 3 | 4 | 5) => {
    setCollectionColumns(c);
    localStorage.setItem('bm_collectionColumns', String(c));
  }, []);

  useEffect(() => {
    if (viewMode === 'folder' && (activeCollection !== COLLECTION.ALL || !isDashboard)) {
      handleViewModeChange('grid');
    }
  }, [activeCollection, viewMode, handleViewModeChange, isDashboard]);

  const [modal, setModal] = useState<{
    type: 'add' | 'collection' | 'none';
    initial?: Partial<Bookmark>;
    existing?: Collection;
  }>({ type: 'none' });

  const { toasts, show: showToast, dismiss: dismissToast } = useToastQueue();
  // Memoize so handler identities (and the memoized child components they're passed to)
  // stay stable across renders — createT returns a fresh closure every call.
  const t = useMemo(() => createT(state.settings.locale), [state.settings.locale]);

  const openGDriveSettings = useCallback(() => {
    // OAuth needs a full tab — popup closes when the auth window opens
    if (!isDashboard) {
      const url = chrome.runtime.getURL('index.html?target=dashboard&gdrive=connect');
      void chrome.tabs.create({ url });
      return;
    }
    setPrefsFocusGDrive(true);
    setShowPrefs(true);
  }, [isDashboard]);

  const handleSyncGDrive = useCallback(async () => {
    if (!gdriveStatus?.connected) {
      openGDriveSettings();
      return;
    }
    setGdriveBusy(true);
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'BM:gdriveSync' } satisfies Message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.gdrive) setGdriveStatus(response.gdrive as GDriveStatus);
          if (response?.error) {
            reject(new Error(String(response.error)));
            return;
          }
          void send({ type: 'BM:getState' });
          resolve();
        });
      });
      showToast(t('gdriveSyncSuccess'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg.split('\n')[0] || t('gdriveSyncFailed'));
      refreshGDriveStatus();
    } finally {
      setGdriveBusy(false);
    }
  }, [gdriveStatus?.connected, openGDriveSettings, refreshGDriveStatus, send, showToast, t]);

  const [currentTabBookmark, setCurrentTabBookmark] = useState<Bookmark | null>(null);

  const handleOpenDashboard = useCallback(() => {
    if (chrome?.tabs && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html?target=dashboard') });
    } else {
      window.open('index.html?target=dashboard', '_blank');
    }
  }, []);

  const handleOpenSidePanel = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId != null && chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        window.close();
        return;
      }
    } catch {
      // fall through
    }
    handleOpenDashboard();
  }, [handleOpenDashboard]);

  useEffect(() => {
    if (!(isLoaded && !isDashboard && chrome?.tabs)) return;
    let ignore = false;
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (ignore) return;
      const tab = tabs[0];
      if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        setCurrentTabBookmark(findBookmarkByUrl(state.bookmarks, tab.url) || null);
      } else {
        setCurrentTabBookmark(null);
      }
    });
    return () => {
      ignore = true;
    };
  }, [isLoaded, state.bookmarks, isDashboard]);

  const descendantsMap = useMemo(
    () => buildDescendantsMap(state.collections),
    [state.collections]
  );

  const filtered = useMemo(() => {
    let result = state.bookmarks;
    const parsed = parseSearchQuery(debouncedSearchQuery);

    if (activeCollection === COLLECTION.TRASH) {
      result = result.filter((b) => b.collectionId === COLLECTION.TRASH);
    } else if (isSmartCollection(activeCollection)) {
      result = filterBySmartCollection(result, activeCollection);
    } else {
      result = result.filter((b) => b.collectionId !== COLLECTION.TRASH);
      if (activeCollection === COLLECTION.UNSORTED) {
        result = result.filter((b) => b.collectionId === COLLECTION.UNSORTED);
      } else if (activeCollection !== COLLECTION.ALL) {
        const descendants = descendantsMap.get(activeCollection);
        result = result.filter(
          (b) => b.collectionId === activeCollection || !!descendants?.has(b.collectionId)
        );
      }
    }

    if (
      debouncedSearchQuery.trim() ||
      parsed.tags.length ||
      parsed.site ||
      parsed.inName ||
      parsed.note
    ) {
      result = result.filter((b) => matchesSearch(b, parsed, state.collections));
    }

    if (activeTags.length > 0) {
      result = result.filter((b) => activeTags.every((tag) => b.tags.includes(tag)));
    }

    return result;
  }, [
    state.bookmarks,
    state.collections,
    activeCollection,
    debouncedSearchQuery,
    activeTags,
    descendantsMap,
  ]);

  const filteredBookmarks = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      switch (sortOrder) {
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'a-z':
          return a.title.localeCompare(b.title);
        case 'z-a':
          return b.title.localeCompare(a.title);
        case 'domain':
          return getDomain(a.url).localeCompare(getDomain(b.url));
        case 'updated':
          return b.updatedAt - a.updatedAt;
        case 'newest':
        default:
          if (typeof a.order === 'number' && typeof b.order === 'number') {
            return a.order - b.order;
          }
          return b.createdAt - a.createdAt;
      }
    });
  }, [filtered, sortOrder]);

  const bookmarkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let allCount = 0;
    let unsortedCount = 0;
    let trashCount = 0;
    for (const b of state.bookmarks) {
      if (b.collectionId === COLLECTION.TRASH) trashCount++;
      else {
        allCount++;
        if (b.collectionId === COLLECTION.UNSORTED) unsortedCount++;
      }
    }
    counts[COLLECTION.ALL] = allCount;
    counts[COLLECTION.UNSORTED] = unsortedCount;
    counts[COLLECTION.TRASH] = trashCount;

    counts[SMART.PINNED] = filterBySmartCollection(state.bookmarks, SMART.PINNED).length;
    counts[SMART.UNTAGGED] = filterBySmartCollection(state.bookmarks, SMART.UNTAGGED).length;
    counts[SMART.NO_COVER] = filterBySmartCollection(state.bookmarks, SMART.NO_COVER).length;
    counts[SMART.THIS_WEEK] = filterBySmartCollection(state.bookmarks, SMART.THIS_WEEK).length;
    counts[SMART.BROKEN] = filterBySmartCollection(state.bookmarks, SMART.BROKEN).length;

    for (const c of state.collections) {
      const descendants = descendantsMap.get(c.id);
      let count = 0;
      for (const b of state.bookmarks) {
        if (b.collectionId === c.id || !!descendants?.has(b.collectionId)) count++;
      }
      counts[c.id] = count;
    }
    return counts;
  }, [state.bookmarks, state.collections, descendantsMap]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    state.bookmarks.forEach((b) => b.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort();
  }, [state.bookmarks]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    filtered.forEach((b) =>
      b.tags.forEach((tag) => {
        if (!activeTags.includes(tag)) tags.add(tag);
      })
    );
    return Array.from(tags).sort();
  }, [filtered, activeTags]);

  const handleSaveBookmark = async (
    data: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => {
    if (data.id || modal.initial?.id) {
      const id = data.id || modal.initial!.id!;
      await send({
        type: 'BM:updateBookmark',
        payload: {
          id,
          url: data.url,
          title: data.title,
          note: data.note,
          tags: data.tags,
          favicon: data.favicon,
          collectionId: data.collectionId,
        },
      });
      showToast(t('bookmarkUpdated'));
    } else {
      await send({ type: 'BM:addBookmark', payload: data });
      showToast(t('bookmarkAdded'));
    }
  };

  const handleSaveCollection = async (data: {
    name: string;
    icon: CollectionIcon;
    color: CollectionColor;
  }) => {
    const editing = modal.type === 'collection' && modal.existing;
    if (editing && modal.existing) {
      await send({
        type: 'BM:updateCollection',
        payload: { ...modal.existing, ...data, id: modal.existing.id },
      });
      showToast(t('collectionUpdated'));
    } else {
      await send({ type: 'BM:addCollection', payload: data });
      showToast(`${t('collectionCreated')}: ${data.name}`);
    }
  };

  const handleQuickAddCollection = async (name: string): Promise<string | undefined> => {
    const beforeIds = new Set(state.collections.map((c) => c.id));
    const res = await send({
      type: 'BM:addCollection',
      payload: { name, icon: 'folder', color: 'blue' },
    });
    showToast(`${t('collectionCreated')}: ${name}`);
    const created = res.collections.find((c) => !beforeIds.has(c.id) && c.name === name);
    if (created) return created.id;
    // Fallback: newest with matching name
    const matches = res.collections.filter((c) => c.name === name);
    if (matches.length === 0) return undefined;
    return matches.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)).id;
  };

  const handleDropBookmark = useCallback(
    async (bookmarkId: string, collectionId: string) => {
      if (collectionId === COLLECTION.ALL) return;
      const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
      if (!bookmark || bookmark.collectionId === collectionId) return;
      if (collectionId === COLLECTION.TRASH) {
        await send({ type: 'BM:moveToTrash', id: bookmarkId });
        showToast(t('movedToTrash'));
        return;
      }
      await send({ type: 'BM:updateBookmark', payload: { ...bookmark, collectionId } });
      showToast('Bookmark moved');
    },
    [state.bookmarks, send, showToast, t]
  );

  const handleDropCollection = useCallback(
    async (draggedId: string, targetId: string | null) => {
      if (draggedId === targetId) return;
      let current = targetId;
      while (current) {
        if (current === draggedId) {
          showToast('Cannot move a folder into itself or its children');
          return;
        }
        const parentColl = state.collections.find((c) => c.id === current);
        current = parentColl?.parentId || null;
      }
      const draggedColl = state.collections.find((c) => c.id === draggedId);
      if (!draggedColl) return;
      await send({
        type: 'BM:updateCollection',
        payload: { ...draggedColl, parentId: targetId || undefined },
      });
      showToast('Collection moved');
    },
    [state.collections, send, showToast]
  );

  const handleTogglePinCollection = useCallback(
    async (id: string) => {
      const collection = state.collections.find((c) => c.id === id);
      if (!collection) return;
      await send({
        type: 'BM:updateCollection',
        payload: { ...collection, pinned: !collection.pinned },
      });
    },
    [state.collections, send]
  );

  const handleImport = async () => {
    if (window.confirm(t('confirmImport'))) {
      showToast('…');
      const res = (await send({ type: 'BM:importBrowser' })) as AppState & {
        imported?: number;
        importedCollections?: number;
      };
      showToast(
        `${t('imported')}: ${res.imported ?? 0} bookmarks` +
          (res.importedCollections ? `, ${res.importedCollections} folders` : '')
      );
    }
  };

  const handleExportData = useCallback(() => {
    let url: string | null = null;
    try {
      const data = {
        bookmarks: state.bookmarks,
        collections: state.collections,
        settings: state.settings,
        exportDate: new Date().toISOString(),
        version: '1.1',
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookmarks-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(t('exported'));
    } catch {
      showToast('Failed to export bookmarks');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }, [state.bookmarks, state.collections, state.settings, showToast, t]);

  const handleRefreshPreviews = async () => {
    showToast('…');
    await send({ type: 'BM:refreshPreviews' });
    showToast(t('previewsDone'));
  };

  const handleCheckBroken = async () => {
    showToast('…');
    await send({ type: 'BM:checkBrokenLinks' });
    showToast(t('brokenCheckDone'));
  };

  const handleEmptyOldTrash = async () => {
    await send({ type: 'BM:emptyOldTrash' });
    showToast(t('trashCleaned'));
  };

  const handleImportJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data && Array.isArray(data.bookmarks) && Array.isArray(data.collections)) {
          await send({
            type: 'BM:importData',
            payload: { bookmarks: data.bookmarks, collections: data.collections },
          });
          if (data.settings && typeof data.settings === 'object') {
            await send({ type: 'BM:updateSettings', payload: data.settings });
          }
          showToast(t('imported'));
        } else {
          showToast('Invalid JSON format');
        }
      } catch {
        showToast('Failed to read JSON file');
      }
    };
    input.click();
  }, [send, showToast, t]);

  const handleTogglePin = useCallback(
    async (id: string) => {
      await send({ type: 'BM:togglePin', id });
    },
    [send]
  );

  const handleEditBookmark = useCallback((bookmark: Bookmark) => {
    setModal({ type: 'add', initial: bookmark });
  }, []);

  const handleDeleteBookmark = useCallback(
    async (id: string, isFromTrash: boolean) => {
      if (isFromTrash) {
        if (!confirm(t('confirmDelete'))) return;
        await send({ type: 'BM:deleteBookmark', id });
        showToast(t('permanentlyDeleted'));
      } else {
        const bookmark = state.bookmarks.find((b) => b.id === id);
        await send({ type: 'BM:moveToTrash', id });
        showToast(
          t('movedToTrash'),
          bookmark
            ? {
                label: t('undo'),
                onClick: async () => {
                  await send({ type: 'BM:updateBookmark', payload: bookmark });
                  showToast(t('restored'));
                },
              }
            : undefined
        );
      }
    },
    [state.bookmarks, send, showToast, t]
  );

  const handleRestoreBookmark = useCallback(
    async (id: string) => {
      await send({ type: 'BM:restoreFromTrash', id });
      showToast(t('restored'));
    },
    [send, showToast, t]
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      // Compare by membership, not size — a stale selection of equal size (containing
      // now-hidden ids after a filter change) shouldn't read as "all selected".
      const allSelected =
        filteredBookmarks.length > 0 && filteredBookmarks.every((b) => prev.has(b.id));
      return allSelected ? new Set() : new Set(filteredBookmarks.map((b) => b.id));
    });
  }, [filteredBookmarks]);

  const handleToggleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleReorder = useCallback(
    async (dragId: string, dropId: string, position: 'before' | 'after' = 'before') => {
      // Reorder within the currently VISIBLE list — the drag/drop ids come from there.
      // Rewriting `order` against the raw state.bookmarks array (which includes trash and
      // other collections) would drop items at the wrong position whenever a filter, search
      // or non-default sort is active.
      const visible = filteredBookmarks;
      const dragIndex = visible.findIndex((b) => b.id === dragId);
      if (dragIndex === -1 || !visible.some((b) => b.id === dropId)) return;

      const reorderedVisible = [...visible];
      const [removed] = reorderedVisible.splice(dragIndex, 1);
      // Insert relative to the drop target, honoring which half of the row was dropped on.
      let target = reorderedVisible.findIndex((b) => b.id === dropId);
      if (target === -1) return;
      if (position === 'after') target += 1;
      reorderedVisible.splice(target, 0, removed);

      // Assign sequential order only to the visible subset; leave off-screen bookmarks as-is.
      const orderMap = new Map<string, number>();
      reorderedVisible.forEach((b, i) => orderMap.set(b.id, i));
      const nextBookmarks = state.bookmarks.map((b) =>
        orderMap.has(b.id) ? { ...b, order: orderMap.get(b.id)! } : b
      );
      await send({ type: 'BM:saveBookmarks', payload: nextBookmarks });
    },
    [filteredBookmarks, state.bookmarks, send]
  );

  const handleBulkDelete = useCallback(async () => {
    if (activeCollection === COLLECTION.TRASH) {
      if (confirm(t('confirmBulkDelete'))) {
        await send({ type: 'BM:bulkDelete', ids: Array.from(selectedIds) });
        setSelectedIds(new Set());
      }
    } else {
      const bookmarksToRestore = state.bookmarks.filter((b) => selectedIds.has(b.id));
      await send({ type: 'BM:bulkMoveToTrash', ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      showToast(
        `${bookmarksToRestore.length} ${t('movedToTrash')}`,
        bookmarksToRestore.length > 0
          ? {
              label: t('undo'),
              onClick: async () => {
                for (const bookmark of bookmarksToRestore) {
                  await send({ type: 'BM:updateBookmark', payload: bookmark });
                }
                showToast(t('restored'));
              },
            }
          : undefined
      );
    }
  }, [activeCollection, selectedIds, state.bookmarks, send, showToast, t]);

  const handleBulkMove = useCallback(
    async (collectionId: string) => {
      await send({
        type: 'BM:bulkMove',
        payload: { ids: Array.from(selectedIds), collectionId },
      });
      setSelectedIds(new Set());
      setIsSelectMode(false);
      showToast('Moved');
    },
    [selectedIds, send, showToast]
  );

  const handleBulkTag = useCallback(
    async (tags: string[]) => {
      await send({
        type: 'BM:bulkTag',
        payload: { ids: Array.from(selectedIds), add: tags },
      });
      showToast('Tags added');
    },
    [selectedIds, send, showToast]
  );

  const handleBulkPin = useCallback(
    async (pinned: boolean) => {
      await send({
        type: 'BM:bulkPin',
        payload: { ids: Array.from(selectedIds), pinned },
      });
      showToast(pinned ? t('pin') : t('unpin'));
    },
    [selectedIds, send, showToast, t]
  );

  useEffect(() => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }, [searchQuery]);

  const handleCancelSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleSelectCollection = useCallback((id: string) => {
    startTransition(() => {
      setActiveCollection(id);
      setActiveTags([]);
      setSelectedIds(new Set());
      setIsSelectMode(false);
    });
  }, []);

  const handleToggleTag = useCallback((tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
    );
  }, []);

  const handleTagClick = useCallback((tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  }, []);

  const handleEditCollectionById = useCallback(
    (id: string) => {
      const collection = state.collections.find((c) => c.id === id);
      if (collection) setModal({ type: 'collection', existing: collection });
    },
    [state.collections]
  );

  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    await send({ type: 'BM:updateSettings', payload: patch });
    showToast(t('settings'));
  };

  if (!isLoaded) {
    // A Chrome popup is sized from its content when it opens. The default
    // popup ends up as QuickSave (380px wide), so paint a matching skeleton
    // first. Painting the 800×600 dashboard skeleton here opens the popup too
    // wide, leaving a gray gutter on one side.
    if (!isDashboard && !forceLibrary) {
      return <QuickSaveSkeleton />;
    }
    return (
      <div
        className={`flex bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 overflow-hidden font-sans ${
          isDashboard ? 'h-screen w-full' : 'w-[800px] h-[600px]'
        }`}
      >
        <SidebarSkeleton />
        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-900">
          <SearchBarSkeleton />
          <div className="flex-1 overflow-hidden">
            <BookmarkListSkeleton count={6} />
          </div>
        </main>
      </div>
    );
  }

  if (showQuickSave) {
    return (
      <>
        <QuickSave
          bookmarks={state.bookmarks}
          collections={state.collections}
          settings={state.settings}
          allTags={allTags}
          onSave={handleSaveBookmark}
          onOpenLibrary={() => setForceLibrary(true)}
          onOpenDashboard={handleOpenDashboard}
          onOpenPreferences={() => {
            setPrefsFocusGDrive(false);
            setShowPrefs(true);
          }}
          onOpenGDrive={openGDriveSettings}
          onSyncGDrive={() => void handleSyncGDrive()}
          gdrive={gdriveUi}
          onQuickAddCollection={handleQuickAddCollection}
        />
        {showPrefs && (
          <Suspense fallback={<ModalSkeleton />}>
            <SettingsModal
              settings={state.settings}
              collections={state.collections}
              onSave={handleUpdateSettings}
              onClose={() => {
                setShowPrefs(false);
                setPrefsFocusGDrive(false);
              }}
              onCheckBroken={handleCheckBroken}
              onEmptyOldTrash={handleEmptyOldTrash}
              onGDriveStateChange={() => {
                void send({ type: 'BM:getState' });
                refreshGDriveStatus();
              }}
              onToast={(msg) => showToast(msg)}
              autoConnectGDrive={prefsFocusGDrive}
            />
          </Suspense>
        )}
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((toastItem) => (
            <div
              key={toastItem.id}
              className="pointer-events-auto bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 animate-slide-up"
              role="status"
            >
              {toastItem.msg}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      className={`flex bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 overflow-hidden font-sans ${
        isDashboard ? 'h-screen w-full' : 'w-[800px] h-[600px]'
      }`}
    >
      <Sidebar
        collections={state.collections}
        activeCollection={activeCollection}
        onSelectCollection={handleSelectCollection}
        bookmarkCounts={bookmarkCounts}
        onNewCollection={() => setModal({ type: 'collection' })}
        onImport={handleImport}
        onImportJson={handleImportJson}
        onExport={handleExportData}
        onRefreshPreviews={handleRefreshPreviews}
        onCheckBroken={handleCheckBroken}
        onOpenPreferences={() => {
          setPrefsFocusGDrive(false);
          setShowPrefs(true);
        }}
        onOpenGDrive={openGDriveSettings}
        onSyncGDrive={() => void handleSyncGDrive()}
        gdrive={gdriveUi}
        activeTags={activeTags}
        availableTags={availableTags}
        onToggleTag={handleToggleTag}
        onOpenDashboard={!isDashboard ? handleOpenDashboard : undefined}
        onOpenSidePanel={!isDashboard ? handleOpenSidePanel : undefined}
        onEditCollection={handleEditCollectionById}
        onTogglePinCollection={handleTogglePinCollection}
        onDropBookmark={handleDropBookmark}
        onDropCollection={handleDropCollection}
        locale={state.settings.locale}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-900">
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          layoutScope={viewMode === 'folder' ? 'collection' : 'bookmark'}
          layoutColumns={viewMode === 'folder' ? collectionColumns : bookmarkColumns}
          onLayoutColumnsChange={
            viewMode === 'folder' ? handleCollectionColumnsChange : handleBookmarkColumnsChange
          }
          allowFolderView={activeCollection === COLLECTION.ALL && isDashboard}
          onAdd={() => setModal({ type: 'add' })}
          currentTabBookmarked={!!currentTabBookmark}
          onEditCurrent={
            currentTabBookmark ? () => handleEditBookmark(currentTabBookmark) : undefined
          }
          selectedCount={selectedIds.size}
          isAllSelected={
            filteredBookmarks.length > 0 &&
            filteredBookmarks.every((b) => selectedIds.has(b.id))
          }
          onSelectAll={handleSelectAll}
          onBulkDelete={handleBulkDelete}
          onBulkMove={handleBulkMove}
          onBulkTag={handleBulkTag}
          onBulkPin={handleBulkPin}
          collections={state.collections}
          isTrashView={activeCollection === COLLECTION.TRASH}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          isSelectMode={isSelectMode}
          onToggleSelectMode={() => setIsSelectMode(true)}
          onCancelSelectMode={handleCancelSelectMode}
          activeTags={activeTags}
          onRemoveTag={handleToggleTag}
          onClearAllFilters={() => {
            setSearchQuery('');
            setActiveTags([]);
          }}
          locale={state.settings.locale}
        />
        <div
          className={`flex-1 overflow-hidden relative transition-opacity duration-150 ${
            isPending ? 'opacity-60 pointer-events-none' : 'opacity-100'
          }`}
        >
          {viewMode === 'folder' && activeCollection === COLLECTION.ALL ? (
            <FolderView
              collections={state.collections}
              bookmarks={filteredBookmarks}
              viewMode="list"
              collectionColumns={collectionColumns}
              onEdit={handleEditBookmark}
              onDelete={handleDeleteBookmark}
              onRestore={handleRestoreBookmark}
              onTogglePin={handleTogglePin}
              onToggleSelect={handleToggleSelect}
              onTagClick={handleTagClick}
              selectedIds={selectedIds}
              isSelectMode={isSelectMode}
              onNewCollection={() => setModal({ type: 'collection' })}
              onReorder={handleReorder}
              isDashboard={isDashboard}
            />
          ) : (
            <BookmarkList
              bookmarks={filteredBookmarks}
              viewMode={viewMode === 'folder' ? 'grid' : viewMode}
              bookmarkColumns={bookmarkColumns}
              searchQuery={searchQuery}
              activeTags={activeTags}
              activeCollection={activeCollection}
              onClearSearch={() => setSearchQuery('')}
              onClearFilters={() => {
                setSearchQuery('');
                setActiveTags([]);
              }}
              onAdd={() => setModal({ type: 'add' })}
              onEdit={handleEditBookmark}
              onDelete={handleDeleteBookmark}
              onRestore={handleRestoreBookmark}
              isTrashView={activeCollection === COLLECTION.TRASH}
              onTogglePin={handleTogglePin}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              isSelectMode={isSelectMode}
              onTagClick={handleTagClick}
              onReorder={handleReorder}
              isDashboard={isDashboard}
            />
          )}
        </div>
      </main>

      <Suspense fallback={<ModalSkeleton />}>
        {modal.type === 'add' && (
          <AddBookmarkModal
            initial={modal.initial}
            existingBookmarks={state.bookmarks}
            collections={state.collections}
            allTags={allTags}
            onSave={handleSaveBookmark}
            onQuickAddCollection={handleQuickAddCollection}
            onClose={() => setModal({ type: 'none' })}
          />
        )}

        {modal.type === 'collection' && (
          <CollectionModal
            existing={modal.existing}
            collections={state.collections}
            onSave={handleSaveCollection}
            onDelete={async (id: string) => {
              if (confirm(t('confirmDeleteCollection'))) {
                await send({ type: 'BM:deleteCollection', id });
                showToast(t('collectionDeleted'));
                if (activeCollection === id) setActiveCollection(COLLECTION.ALL);
                setModal({ type: 'none' });
              }
            }}
            onClose={() => setModal({ type: 'none' })}
          />
        )}

        {showPrefs && (
          <SettingsModal
            settings={state.settings}
            collections={state.collections}
            onSave={handleUpdateSettings}
            onClose={() => {
              setShowPrefs(false);
              setAutoGdriveConnect(false);
              setPrefsFocusGDrive(false);
              // Clean deep-link query so refresh doesn't re-trigger connect
              if (params.get('gdrive') === 'connect') {
                const url = new URL(window.location.href);
                url.searchParams.delete('gdrive');
                window.history.replaceState({}, '', url.toString());
              }
            }}
            onCheckBroken={handleCheckBroken}
            onEmptyOldTrash={handleEmptyOldTrash}
            onGDriveStateChange={() => {
              void send({ type: 'BM:getState' });
              refreshGDriveStatus();
            }}
            onToast={(msg) => showToast(msg)}
            autoConnectGDrive={autoGdriveConnect || prefsFocusGDrive}
          />
        )}
      </Suspense>

      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((toastItem) => (
          <div
            key={toastItem.id}
            className="pointer-events-auto bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 animate-slide-up"
            role="status"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            {toastItem.msg}
            {toastItem.action && (
              <button
                onClick={async () => {
                  const action = toastItem.action;
                  if (!action) return;
                  dismissToast(toastItem.id);
                  await action.onClick();
                }}
                className="ml-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 font-semibold"
              >
                {toastItem.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
