import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
  useTransition,
} from 'react';
import { Sidebar } from './components/Sidebar';
import { SearchBar } from './components/SearchBar';
import { CollectionHeader } from './components/CollectionHeader';
import { BookmarkList } from './components/BookmarkList';
import { FolderView } from './components/FolderView';
import { QuickSave } from './components/QuickSave';
import { ConfirmDialog, type ConfirmDialogState } from './components/ConfirmDialog';
import { ToastStack } from './components/ui/Toast';
import { ReauthBanner } from './components/ui/DriveStatus';
import { useApplyTheme } from './components/ui/ThemeProvider';
import {
  SidebarSkeleton,
  SearchBarSkeleton,
  BookmarkListSkeleton,
  ModalSkeleton,
  QuickSaveSkeleton,
} from './components/Skeletons';
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
  type ThemeMode,
  type ViewMode,
} from './types';
import {
  buildDescendantsMap,
  buildRelatedRootsMap,
  exportBookmarksToHtml,
  filterBySmartCollection,
  findBookmarkByUrl,
  getDomain,
  hasSearchOperators,
  isBrokenLink,
  matchesSearch,
  parseNetscapeBookmarksHtml,
  parseSearchQuery,
} from './utils';
import { useDebouncedValue, useToastQueue } from './hooks';
import { createT, setLocale } from './i18n';
import { STORAGE_KEYS } from './storage';
import type { GDriveStatus, GDriveUiStatus } from './driveSync';

const AddBookmarkModal = lazy(() =>
  import('./components/AddBookmarkModal').then((m) => ({ default: m.AddBookmarkModal }))
);
const CollectionModal = lazy(() =>
  import('./components/CollectionModal').then((m) => ({ default: m.CollectionModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);

type ColumnCount = 1 | 2 | 3 | 4 | 5;

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
    (msg: Message): Promise<AppState & Record<string, unknown>> => {
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
            resolve(response as AppState & Record<string, unknown>);
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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const lastSelectedIdRef = useRef<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [showPrefs, setShowPrefs] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [forceLibrary, setForceLibrary] = useState(isLibrary);
  const [autoGdriveConnect, setAutoGdriveConnect] = useState(
    () => params.get('gdrive') === 'connect'
  );
  const [prefsFocusGDrive, setPrefsFocusGDrive] = useState(
    () => params.get('gdrive') === 'connect'
  );
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveBusy, setGdriveBusy] = useState(false);

  // Responsive sidebar collapse (auto-collapse in narrow Chrome Side Panel)
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 680
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 680) return false;
    return localStorage.getItem('bm_sidebarHidden') !== '1';
  });

  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < 680;
      setIsNarrowViewport(narrow);
      if (narrow) setSidebarOpen(false);
      else setSidebarOpen(localStorage.getItem('bm_sidebarHidden') !== '1');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (!isNarrowViewport) {
        localStorage.setItem('bm_sidebarHidden', next ? '0' : '1');
      }
      return next;
    });
  }, [isNarrowViewport]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('bm_viewMode') as ViewMode | null;
    if (saved === 'grid' || saved === 'list' || saved === 'masonry' || saved === 'folder') {
      return saved;
    }
    return 'list';
  });

  const showQuickSave =
    !isDashboard && !forceLibrary && state.settings.showQuickSave !== false;

  useApplyTheme(state.settings.theme);

  useEffect(() => {
    setLocale(state.settings.locale);
  }, [state.settings.locale]);

  useEffect(() => {
    if (state.settings.defaultSort) setSortOrder(state.settings.defaultSort);
  }, [state.settings.defaultSort]);

  const didSeedViewMode = useRef(false);
  useEffect(() => {
    if (!isLoaded || didSeedViewMode.current) return;
    didSeedViewMode.current = true;
    if (!localStorage.getItem('bm_viewMode') && state.settings.defaultViewMode) {
      setViewMode(state.settings.defaultViewMode);
    }
  }, [isLoaded, state.settings.defaultViewMode]);

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
    // Background auto-sync updates this key; keep sidebar / popup status live.
    const onDriveChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.bm_drive_state) refreshGDriveStatus();
    };
    chrome.storage.onChanged.addListener(onDriveChanged);
    return () => chrome.storage.onChanged.removeListener(onDriveChanged);
  }, [isLoaded, refreshGDriveStatus]);

  const gdriveUi: GDriveUiStatus | null = useMemo(() => {
    if (!gdriveStatus) {
      return { connected: false, email: null, lastSyncAt: null, busy: gdriveBusy };
    }
    return {
      connected: gdriveStatus.connected,
      needsReauth: gdriveStatus.needsReauth,
      status: gdriveStatus.status,
      email: gdriveStatus.email,
      lastSyncAt: gdriveStatus.lastSyncAt,
      busy: gdriveBusy || gdriveStatus.syncing,
    };
  }, [gdriveStatus, gdriveBusy]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('bm_viewMode', mode);
  }, []);

  const [bookmarkColumns, setBookmarkColumns] = useState<ColumnCount>(() =>
    parseColumns(localStorage.getItem('bm_bookmarkColumns'), isDashboard ? 3 : 2)
  );

  const handleBookmarkColumnsChange = useCallback((c: ColumnCount) => {
    setBookmarkColumns(c);
    localStorage.setItem('bm_bookmarkColumns', String(c));
  }, []);

  const [collectionColumns, setCollectionColumns] = useState<ColumnCount>(() =>
    parseColumns(localStorage.getItem('bm_collectionColumns'), 3)
  );

  const handleCollectionColumnsChange = useCallback((c: ColumnCount) => {
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
  const t = useMemo(() => createT(state.settings.locale), [state.settings.locale]);

  const openGDriveSettings = useCallback(() => {
    if (!isDashboard) {
      const url = chrome.runtime.getURL('index.html?target=dashboard&gdrive=connect');
      void chrome.tabs.create({ url });
      return;
    }
    setPrefsFocusGDrive(true);
    setShowPrefs(true);
  }, [isDashboard]);

  const handleSyncGDrive = useCallback(async () => {
    if (!gdriveStatus?.connected || gdriveStatus.needsReauth) {
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
  }, [gdriveStatus?.connected, gdriveStatus?.needsReauth, openGDriveSettings, refreshGDriveStatus, send, showToast, t]);

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

  const relatedRootsMap = useMemo(
    () => buildRelatedRootsMap(state.bookmarks),
    [state.bookmarks]
  );

  const parsedSearch = useMemo(
    () => parseSearchQuery(debouncedSearchQuery),
    [debouncedSearchQuery]
  );

  const filtered = useMemo(() => {
    let result = state.bookmarks;

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

    if (hasSearchOperators(parsedSearch)) {
      result = result.filter((b) => matchesSearch(b, parsedSearch, state.collections));
    }

    if (activeTags.length > 0) {
      result = result.filter((b) => activeTags.every((tag) => b.tags.includes(tag)));
    }

    return result;
  }, [
    state.bookmarks,
    state.collections,
    activeCollection,
    parsedSearch,
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

  // Reset keyboard focus index when filtered list changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [activeCollection, debouncedSearchQuery, activeTags, sortOrder]);

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
    counts[SMART.WITH_NOTES] = filterBySmartCollection(state.bookmarks, SMART.WITH_NOTES).length;
    counts[SMART.NO_COVER] = filterBySmartCollection(state.bookmarks, SMART.NO_COVER).length;
    counts[SMART.THIS_WEEK] = filterBySmartCollection(state.bookmarks, SMART.THIS_WEEK).length;
    counts[SMART.BROKEN] = filterBySmartCollection(state.bookmarks, SMART.BROKEN).length;
    counts[SMART.DUPLICATES] = filterBySmartCollection(state.bookmarks, SMART.DUPLICATES).length;

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

  const { allTags, tagCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of state.bookmarks) {
      if (b.collectionId === COLLECTION.TRASH) continue;
      for (const tag of b.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    return { allTags: sorted, tagCounts: counts };
  }, [state.bookmarks]);

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((b) =>
      b.tags.forEach((tag) => {
        if (!activeTags.includes(tag)) counts.set(tag, (counts.get(tag) || 0) + 1);
      })
    );
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [filtered, activeTags]);

  const libraryStats = useMemo(() => {
    const nonTrash = state.bookmarks.filter((b) => b.collectionId !== COLLECTION.TRASH);
    return {
      totalBookmarks: nonTrash.length,
      totalCollections: state.collections.length,
      totalTags: allTags.length,
      pinnedCount: nonTrash.filter((b) => b.pinned).length,
      brokenCount: nonTrash.filter((b) => isBrokenLink(b)).length,
    };
  }, [state.bookmarks, state.collections, allTags.length]);

  // ─── Mutations & Actions ────────────────────────────────────────────────────

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
          pinned: data.pinned,
          coverUrl: data.coverUrl,
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
    parentId?: string;
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
      showToast(t('bookmarkMoved'));
    },
    [state.bookmarks, send, showToast, t]
  );

  const handleDropCollection = useCallback(
    async (draggedId: string, targetId: string | null) => {
      if (draggedId === targetId) return;
      let current = targetId;
      while (current) {
        if (current === draggedId) {
          showToast(t('cannotMoveIntoItself'));
          return;
        }
        const parentColl = state.collections.find((c) => c.id === current);
        current = parentColl?.parentId || null;
      }
      const draggedColl = state.collections.find((c) => c.id === draggedId);
      if (!draggedColl) return;
      if ((draggedColl.parentId || null) === (targetId || null)) return;
      await send({
        type: 'BM:updateCollection',
        payload: { ...draggedColl, parentId: targetId || undefined },
      });
      showToast(t('collectionMoved'));
    },
    [state.collections, send, showToast, t]
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

  const handleImport = useCallback(() => {
    setConfirmDialog({
      title: t('importBrowser'),
      message: t('confirmImport'),
      confirmLabel: t('importBrowser'),
      variant: 'primary',
      onConfirm: async () => {
        showToast('…');
        const res = await send({ type: 'BM:importBrowser' });
        const imported = Number(res.imported ?? 0);
        const importedCols = Number(res.importedCollections ?? 0);
        showToast(
          `${t('imported')}: ${imported} ${t('bookmarksLabel')}` +
            (importedCols ? `, ${importedCols} ${t('foldersLabel')}` : '')
        );
      },
    });
  }, [send, showToast, t]);

  const handleExportData = useCallback(() => {
    let url: string | null = null;
    try {
      const data = {
        bookmarks: state.bookmarks,
        collections: state.collections,
        settings: state.settings,
        exportDate: new Date().toISOString(),
        version: '1.2',
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
      showToast(t('exportFailed'));
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }, [state.bookmarks, state.collections, state.settings, showToast, t]);

  const handleExportHtml = useCallback(() => {
    let url: string | null = null;
    try {
      const html = exportBookmarksToHtml(state.bookmarks, state.collections);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookmarks-${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(t('exported'));
    } catch {
      showToast(t('exportFailed'));
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }, [state.bookmarks, state.collections, showToast, t]);

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
          showToast(t('invalidJson'));
        }
      } catch {
        showToast(t('jsonReadFailed'));
      }
    };
    input.click();
  }, [send, showToast, t]);

  const handleImportHtml = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseNetscapeBookmarksHtml(text);
        if (parsed.bookmarks.length === 0) {
          showToast(t('invalidHtml'));
          return;
        }
        await send({ type: 'BM:importData', payload: parsed });
        showToast(`${t('imported')}: ${parsed.bookmarks.length} ${t('bookmarksLabel')}`);
      } catch {
        showToast(t('invalidHtml'));
      }
    };
    input.click();
  }, [send, showToast, t]);

  const handleRefreshPreviews = useCallback(async () => {
    showToast('…');
    await send({ type: 'BM:refreshPreviews' });
    showToast(t('previewsDone'));
  }, [send, showToast, t]);

  const handleCheckBroken = useCallback(async () => {
    showToast('…');
    await send({ type: 'BM:checkBrokenLinks' });
    showToast(t('brokenCheckDone'));
  }, [send, showToast, t]);

  const handleEmptyOldTrash = useCallback(async () => {
    await send({ type: 'BM:emptyOldTrash' });
    showToast(t('trashCleaned'));
  }, [send, showToast, t]);

  const handleEmptyTrash = useCallback(() => {
    setConfirmDialog({
      title: t('emptyTrash'),
      message: t('confirmEmptyTrash'),
      confirmLabel: t('emptyTrash'),
      variant: 'danger',
      onConfirm: async () => {
        await send({ type: 'BM:emptyTrash' });
        setSelectedIds(new Set());
        showToast(t('trashEmptied'));
      },
    });
  }, [send, showToast, t]);

  const handleSaveAllTabs = useCallback(async () => {
    const tabs = (await chrome.tabs?.query({ currentWindow: true })) ?? [];
    const saveableCount = tabs.filter(
      (tab) => tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))
    ).length;

    if (saveableCount === 0) {
      showToast(t('noTabsToSave'));
      return;
    }

    const now = new Date();
    const label = `${t('sessionPrefix')} ${now.toLocaleDateString(
      state.settings.locale === 'vi' ? 'vi-VN' : 'en-US',
      { month: 'short', day: 'numeric' }
    )} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    setConfirmDialog({
      title: t('saveAllTabs'),
      message: t('confirmSaveAllTabs', { n: String(saveableCount), name: label }),
      confirmLabel: t('saveAllTabs'),
      variant: 'primary',
      onConfirm: async () => {
        const res = await send({ type: 'BM:saveAllTabs', payload: { collectionName: label } });
        const count = Number(res.savedCount ?? 0);
        if (count > 0) {
          showToast(t('savedTabs', { n: String(count) }));
          if (typeof res.collectionId === 'string' && res.collectionId && !showQuickSave) {
            setActiveCollection(res.collectionId);
          }
        } else {
          showToast(t('noTabsToSave'));
        }
      },
    });
  }, [send, showToast, showQuickSave, state.settings.locale, t]);

  const handleCycleTheme = useCallback(async () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(state.settings.theme);
    const next = order[(idx + 1) % order.length];
    await send({ type: 'BM:updateSettings', payload: { theme: next } });
    const modeLabel =
      next === 'dark' ? t('themeDark') : next === 'light' ? t('themeLight') : t('themeSystem');
    showToast(t('switchTheme', { mode: modeLabel }));
  }, [state.settings.theme, send, showToast, t]);

  const handleTogglePin = useCallback(
    async (id: string) => {
      await send({ type: 'BM:togglePin', id });
    },
    [send]
  );

  const handleEditBookmark = useCallback((bookmark: Bookmark) => {
    setModal({ type: 'add', initial: bookmark });
  }, []);

  const handleCopyUrlToast = useCallback(() => {
    showToast(t('urlCopied'));
  }, [showToast, t]);

  const handleDeleteBookmark = useCallback(
    async (id: string, isFromTrash: boolean) => {
      if (isFromTrash) {
        setConfirmDialog({
          title: t('deletePermanently'),
          message: t('confirmDelete'),
          confirmLabel: t('deletePermanently'),
          variant: 'danger',
          onConfirm: async () => {
            await send({ type: 'BM:deleteBookmark', id });
            showToast(t('permanentlyDeleted'));
          },
        });
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
      const allSelected =
        filteredBookmarks.length > 0 && filteredBookmarks.every((b) => prev.has(b.id));
      return allSelected ? new Set() : new Set(filteredBookmarks.map((b) => b.id));
    });
  }, [filteredBookmarks]);

  const handleToggleSelect = useCallback(
    (id: string, selected: boolean, shiftKey = false) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastSelectedIdRef.current) {
          const a = filteredBookmarks.findIndex((b) => b.id === lastSelectedIdRef.current);
          const b = filteredBookmarks.findIndex((b) => b.id === id);
          if (a !== -1 && b !== -1) {
            const [start, end] = a < b ? [a, b] : [b, a];
            for (let i = start; i <= end; i++) {
              if (selected) next.add(filteredBookmarks[i].id);
              else next.delete(filteredBookmarks[i].id);
            }
            lastSelectedIdRef.current = id;
            return next;
          }
        }
        if (selected) next.add(id);
        else next.delete(id);
        lastSelectedIdRef.current = id;
        return next;
      });
    },
    [filteredBookmarks]
  );

  const handleReorder = useCallback(
    async (dragId: string, dropId: string, position: 'before' | 'after' = 'before') => {
      const visible = filteredBookmarks;
      const dragIndex = visible.findIndex((b) => b.id === dragId);
      if (dragIndex === -1 || !visible.some((b) => b.id === dropId)) return;

      const reorderedVisible = [...visible];
      const [removed] = reorderedVisible.splice(dragIndex, 1);
      let target = reorderedVisible.findIndex((b) => b.id === dropId);
      if (target === -1) return;
      if (position === 'after') target += 1;
      reorderedVisible.splice(target, 0, removed);

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
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (activeCollection === COLLECTION.TRASH) {
      setConfirmDialog({
        title: t('deletePermanently'),
        message: t('confirmBulkDelete'),
        confirmLabel: t('deletePermanently'),
        variant: 'danger',
        onConfirm: async () => {
          await send({ type: 'BM:bulkDelete', ids });
          setSelectedIds(new Set());
          showToast(t('permanentlyDeleted'));
        },
      });
    } else {
      const bookmarksToRestore = state.bookmarks.filter((b) => selectedIds.has(b.id));
      await send({ type: 'BM:bulkMoveToTrash', ids });
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

  const handleBulkRestore = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await send({ type: 'BM:bulkRestore', ids });
    setSelectedIds(new Set());
    setIsSelectMode(false);
    showToast(t('restored'));
  }, [selectedIds, send, showToast, t]);

  const openUrlsInTabs = useCallback(
    (urls: string[]) => {
      const run = () => {
        for (const url of urls) {
          if (chrome?.tabs?.create) {
            void chrome.tabs.create({ url, active: false });
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }
      };
      if (urls.length > 10) {
        setConfirmDialog({
          title: t('openAll'),
          message: t('confirmOpenManyTabs', { n: String(urls.length) }),
          confirmLabel: t('openAll'),
          variant: 'primary',
          onConfirm: run,
        });
      } else {
        run();
      }
    },
    [t]
  );

  const handleBulkOpenTabs = useCallback(() => {
    const urls = filteredBookmarks
      .filter((b) => selectedIds.has(b.id))
      .map((b) => b.url);
    if (urls.length > 0) openUrlsInTabs(urls);
  }, [filteredBookmarks, selectedIds, openUrlsInTabs]);

  const handleOpenAllInView = useCallback(() => {
    const urls = filteredBookmarks.map((b) => b.url);
    if (urls.length > 0) openUrlsInTabs(urls);
  }, [filteredBookmarks, openUrlsInTabs]);

  const handleBulkMove = useCallback(
    async (collectionId: string) => {
      await send({
        type: 'BM:bulkMove',
        payload: { ids: Array.from(selectedIds), collectionId },
      });
      setSelectedIds(new Set());
      setIsSelectMode(false);
      showToast(t('moved'));
    },
    [selectedIds, send, showToast, t]
  );

  const handleBulkTag = useCallback(
    async (tags: string[], mode: 'add' | 'remove' = 'add') => {
      await send({
        type: 'BM:bulkTag',
        payload: {
          ids: Array.from(selectedIds),
          ...(mode === 'add' ? { add: tags } : { remove: tags }),
        },
      });
      showToast(mode === 'add' ? t('tagsAdded') : t('tagsRemoved'));
    },
    [selectedIds, send, showToast, t]
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

  const handleRenameTag = useCallback(
    async (oldTag: string, newTag: string) => {
      await send({ type: 'BM:renameTag', payload: { oldTag, newTag } });
      setActiveTags((prev) => prev.map((x) => (x === oldTag ? newTag.toLowerCase() : x)));
      showToast(t('tagRenamed'));
    },
    [send, showToast, t]
  );

  const handleDeleteTag = useCallback(
    (tag: string) => {
      setConfirmDialog({
        title: t('deleteTag'),
        message: t('confirmDeleteTag', { tag }),
        confirmLabel: t('delete'),
        variant: 'danger',
        onConfirm: async () => {
          await send({ type: 'BM:deleteTag', tag });
          setActiveTags((prev) => prev.filter((x) => x !== tag));
          showToast(t('tagDeleted'));
        },
      });
    },
    [send, showToast, t]
  );

  useEffect(() => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }, [searchQuery]);

  const handleCancelSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  const handleSelectCollection = useCallback(
    (id: string) => {
      startTransition(() => {
        setActiveCollection(id);
        setActiveTags([]);
        setSelectedIds(new Set());
        setIsSelectMode(false);
      });
      if (isNarrowViewport) setSidebarOpen(false);
    },
    [isNarrowViewport]
  );

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
    const prevView = state.settings.defaultViewMode;
    await send({ type: 'BM:updateSettings', payload: patch });
    if (patch.defaultViewMode && patch.defaultViewMode !== prevView) {
      handleViewModeChange(patch.defaultViewMode);
    }
    showToast(t('settings'));
  };

  const openAddModal = useCallback(
    (overrideCollectionId?: string) => {
      const targetCol =
        overrideCollectionId ??
        (activeCollection !== COLLECTION.ALL &&
        activeCollection !== COLLECTION.TRASH &&
        !isSmartCollection(activeCollection)
          ? activeCollection
          : state.settings.defaultCollectionId || COLLECTION.UNSORTED);
      setModal({ type: 'add', initial: { collectionId: targetCol } });
    },
    [activeCollection, state.settings.defaultCollectionId]
  );

  // ─── Global Keyboard Navigation & Command Palette ──────────────────────────
  useEffect(() => {
    if (showQuickSave || !isLoaded) return;

    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K opens Command Palette even inside inputs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }

      // Skip shortcuts when a dialog/modal is open or focus is in an editable element
      if (showCommandPalette || showPrefs || modal.type !== 'none' || confirmDialog) return;

      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (isEditable || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'n') {
        e.preventDefault();
        openAddModal();
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (filteredBookmarks.length === 0) return;
        e.preventDefault();
        setFocusedIndex((idx) => Math.min(filteredBookmarks.length - 1, idx + 1));
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        if (filteredBookmarks.length === 0) return;
        e.preventDefault();
        setFocusedIndex((idx) => (idx <= 0 ? 0 : idx - 1));
        return;
      }

      if (e.key === 'Escape') {
        if (isSelectMode) {
          handleCancelSelectMode();
        } else if (focusedIndex !== -1) {
          setFocusedIndex(-1);
        }
        return;
      }

      const focused = focusedIndex >= 0 ? filteredBookmarks[focusedIndex] : undefined;
      if (!focused) return;

      if (e.key === 'Enter' && target?.tagName !== 'BUTTON' && target?.tagName !== 'A') {
        e.preventDefault();
        window.open(focused.url, '_blank', 'noopener,noreferrer');
      } else if (e.key === 'e' && activeCollection !== COLLECTION.TRASH) {
        e.preventDefault();
        handleEditBookmark(focused);
      } else if (e.key === 'p' && activeCollection !== COLLECTION.TRASH) {
        e.preventDefault();
        void handleTogglePin(focused.id);
      } else if (e.key === 'c') {
        e.preventDefault();
        void navigator.clipboard.writeText(focused.url).then(() => showToast(t('urlCopied')));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void handleDeleteBookmark(focused.id, activeCollection === COLLECTION.TRASH);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    showQuickSave,
    isLoaded,
    showCommandPalette,
    showPrefs,
    modal.type,
    confirmDialog,
    filteredBookmarks,
    focusedIndex,
    isSelectMode,
    activeCollection,
    openAddModal,
    handleCancelSelectMode,
    handleEditBookmark,
    handleTogglePin,
    handleDeleteBookmark,
    showToast,
    t,
  ]);

  // ─── Loading Skeleton ───────────────────────────────────────────────────────
  if (!isLoaded) {
    if (!isDashboard && !forceLibrary) {
      return <QuickSaveSkeleton />;
    }
    return (
      <div
        className={`flex bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans ${
          isDashboard ? 'h-screen w-full' : 'w-[800px] h-[600px]'
        }`}
      >
        <SidebarSkeleton />
        <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg)]">
          <SearchBarSkeleton />
          <div className="flex-1 overflow-hidden">
            <BookmarkListSkeleton count={6} />
          </div>
        </main>
      </div>
    );
  }

  // ─── Quick Save Popup ───────────────────────────────────────────────────────
  if (showQuickSave) {
    return (
      <>
        <QuickSave
          bookmarks={state.bookmarks}
          collections={state.collections}
          settings={state.settings}
          allTags={allTags}
          onSave={handleSaveBookmark}
          onRemove={async (id) => {
            await send({ type: 'BM:moveToTrash', id });
            showToast(t('movedToTrash'));
          }}
          onOpenLibrary={(colId) => {
            if (colId) setActiveCollection(colId);
            setForceLibrary(true);
          }}
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
              stats={libraryStats}
              onSave={handleUpdateSettings}
              onClose={() => {
                setShowPrefs(false);
                setPrefsFocusGDrive(false);
              }}
              onCheckBroken={handleCheckBroken}
              onEmptyOldTrash={handleEmptyOldTrash}
              onRefreshPreviews={handleRefreshPreviews}
              onImportJson={handleImportJson}
              onImportHtml={handleImportHtml}
              onImportBrowser={handleImport}
              onExport={handleExportData}
              onExportHtml={handleExportHtml}
              onGDriveStateChange={() => {
                void send({ type: 'BM:getState' });
                refreshGDriveStatus();
              }}
              onToast={(msg) => showToast(msg)}
              autoConnectGDrive={prefsFocusGDrive}
            />
          </Suspense>
        )}
        {confirmDialog && (
          <ConfirmDialog
            dialog={confirmDialog}
            locale={state.settings.locale}
            onClose={() => setConfirmDialog(null)}
          />
        )}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  // ─── Full Dashboard / Library ───────────────────────────────────────────────
  const showCollectionBadge =
    activeCollection === COLLECTION.ALL ||
    isSmartCollection(activeCollection) ||
    Boolean(debouncedSearchQuery.trim());

  const sidebarNode = (
    <Sidebar
      collections={state.collections}
      activeCollection={activeCollection}
      onSelectCollection={handleSelectCollection}
      bookmarkCounts={bookmarkCounts}
      tagCounts={tagCounts}
      onNewCollection={() => setModal({ type: 'collection' })}
      onImport={handleImport}
      onImportJson={handleImportJson}
      onExport={handleExportData}
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
      onRenameTag={handleRenameTag}
      onDeleteTag={handleDeleteTag}
      onOpenDashboard={!isDashboard ? handleOpenDashboard : undefined}
      onOpenSidePanel={!isDashboard ? handleOpenSidePanel : undefined}
      onEditCollection={handleEditCollectionById}
      onTogglePinCollection={handleTogglePinCollection}
      onDropBookmark={handleDropBookmark}
      onDropCollection={handleDropCollection}
      theme={state.settings.theme}
      onCycleTheme={() => void handleCycleTheme()}
      locale={state.settings.locale}
    />
  );

  return (
    <div
      className={`flex bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans relative ${
        isDashboard ? 'h-screen w-full' : 'w-[800px] h-[600px]'
      }`}
    >
      {/* Desktop / Wide Sidebar */}
      {!isNarrowViewport && sidebarOpen && sidebarNode}

      {/* Narrow Viewport / Chrome Side Panel Overlay Drawer */}
      {isNarrowViewport && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 flex bg-black/55"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="h-full shadow-pop" onClick={(e) => e.stopPropagation()}>
            {sidebarNode}
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg)]">
        {gdriveUi?.needsReauth && (
          <ReauthBanner
            message={t('popupReauthBanner')}
            actionLabel={t('gdriveReconnect')}
            busy={gdriveUi.busy}
            onAction={openGDriveSettings}
          />
        )}
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
          onAdd={() => openAddModal()}
          onOpenCommandPalette={() => setShowCommandPalette(true)}
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
          onBulkRestore={handleBulkRestore}
          onBulkOpenTabs={handleBulkOpenTabs}
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

        <CollectionHeader
          activeCollection={activeCollection}
          collections={state.collections}
          itemCount={filteredBookmarks.length}
          locale={state.settings.locale}
          sidebarCollapsed={!sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onSelectCollection={handleSelectCollection}
          onEmptyTrash={handleEmptyTrash}
          onOpenAll={handleOpenAllInView}
          onCheckBroken={() => void handleCheckBroken()}
          onRefreshPreviews={() => void handleRefreshPreviews()}
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
              relatedRoots={relatedRootsMap}
              onSelectCollection={handleSelectCollection}
              onAddInCollection={(colId) => openAddModal(colId)}
              onDropBookmark={handleDropBookmark}
              onEdit={handleEditBookmark}
              onDelete={handleDeleteBookmark}
              onRestore={handleRestoreBookmark}
              onCopyUrl={handleCopyUrlToast}
              onTogglePin={handleTogglePin}
              onToggleSelect={handleToggleSelect}
              onTagClick={handleTagClick}
              selectedIds={selectedIds}
              isSelectMode={isSelectMode}
              onNewCollection={() => setModal({ type: 'collection' })}
              onReorder={handleReorder}
              isDashboard={isDashboard}
              locale={state.settings.locale}
            />
          ) : (
            <BookmarkList
              bookmarks={filteredBookmarks}
              collections={state.collections}
              showCollectionBadge={showCollectionBadge}
              onCollectionClick={handleSelectCollection}
              viewMode={viewMode === 'folder' ? 'grid' : viewMode}
              bookmarkColumns={bookmarkColumns}
              relatedRoots={relatedRootsMap}
              searchQuery={searchQuery}
              highlightQuery={parsedSearch.text}
              activeTags={activeTags}
              activeCollection={activeCollection}
              onClearSearch={() => setSearchQuery('')}
              onClearFilters={() => {
                setSearchQuery('');
                setActiveTags([]);
              }}
              onAdd={() => openAddModal()}
              onEdit={handleEditBookmark}
              onDelete={handleDeleteBookmark}
              onRestore={handleRestoreBookmark}
              onCopyUrl={handleCopyUrlToast}
              isTrashView={activeCollection === COLLECTION.TRASH}
              onTogglePin={handleTogglePin}
              selectedIds={selectedIds}
              focusedIndex={focusedIndex}
              onToggleSelect={handleToggleSelect}
              isSelectMode={isSelectMode}
              onTagClick={handleTagClick}
              onReorder={handleReorder}
              isDashboard={isDashboard}
              locale={state.settings.locale}
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
            locale={state.settings.locale}
          />
        )}

        {modal.type === 'collection' && (
          <CollectionModal
            existing={modal.existing}
            collections={state.collections}
            onSave={handleSaveCollection}
            onDelete={(id: string) => {
              setConfirmDialog({
                title: t('delete'),
                message: t('confirmDeleteCollection'),
                confirmLabel: t('delete'),
                variant: 'danger',
                onConfirm: async () => {
                  await send({ type: 'BM:deleteCollection', id });
                  showToast(t('collectionDeleted'));
                  if (activeCollection === id) setActiveCollection(COLLECTION.ALL);
                  setModal({ type: 'none' });
                },
              });
            }}
            onClose={() => setModal({ type: 'none' })}
            locale={state.settings.locale}
          />
        )}

        {showPrefs && (
          <SettingsModal
            settings={state.settings}
            collections={state.collections}
            stats={libraryStats}
            onSave={handleUpdateSettings}
            onClose={() => {
              setShowPrefs(false);
              setAutoGdriveConnect(false);
              setPrefsFocusGDrive(false);
              if (params.get('gdrive') === 'connect') {
                const url = new URL(window.location.href);
                url.searchParams.delete('gdrive');
                window.history.replaceState({}, '', url.toString());
              }
            }}
            onCheckBroken={handleCheckBroken}
            onEmptyOldTrash={handleEmptyOldTrash}
            onRefreshPreviews={handleRefreshPreviews}
            onImportJson={handleImportJson}
            onImportHtml={handleImportHtml}
            onImportBrowser={handleImport}
            onExport={handleExportData}
            onExportHtml={handleExportHtml}
            onGDriveStateChange={() => {
              void send({ type: 'BM:getState' });
              refreshGDriveStatus();
            }}
            onToast={(msg) => showToast(msg)}
            autoConnectGDrive={autoGdriveConnect || prefsFocusGDrive}
          />
        )}

        {showCommandPalette && (
          <CommandPalette
            bookmarks={state.bookmarks}
            collections={state.collections}
            locale={state.settings.locale}
            theme={state.settings.theme}
            allowFolderView={activeCollection === COLLECTION.ALL && isDashboard}
            onClose={() => setShowCommandPalette(false)}
            onSelectCollection={handleSelectCollection}
            onAddBookmark={() => openAddModal()}
            onNewCollection={() => setModal({ type: 'collection' })}
            onSaveAllTabs={() => void handleSaveAllTabs()}
            onOpenSettings={() => {
              setPrefsFocusGDrive(false);
              setShowPrefs(true);
            }}
            onSyncGDrive={() => void handleSyncGDrive()}
            onCycleTheme={() => void handleCycleTheme()}
            onChangeView={handleViewModeChange}
            onCheckBroken={() => void handleCheckBroken()}
            onRefreshPreviews={() => void handleRefreshPreviews()}
          />
        )}
      </Suspense>

      {confirmDialog && (
        <ConfirmDialog
          dialog={confirmDialog}
          locale={state.settings.locale}
          onClose={() => setConfirmDialog(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
