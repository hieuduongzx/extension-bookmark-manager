import {
  saveBookmarks,
  saveCollections,
  saveSettings,
  getInitialState,
  recordTombstones,
} from './storage';
import {
  COLLECTION,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AppState,
  type Bookmark,
  type Collection,
} from './types';
import {
  canFetchPreview,
  findBookmarkByUrl,
  generateId,
  getDomain,
  getFavicon,
  isSafeBookmarkUrl,
  sanitizeBookmarkUrl,
} from './utils';
import {
  connectGDrive,
  disconnectGDrive,
  ensureGDriveAlarm,
  getGDriveStatus,
  GDRIVE_ALARM,
  loadGDriveMeta,
  syncWithGoogleDrive,
} from './gdrive';

// ─── In-Memory State Cache ──────────────────────────────────────────────────

let stateCache: AppState | null = null;

async function ensureCache(): Promise<AppState> {
  if (!stateCache) {
    stateCache = await getInitialState();
  }
  return stateCache;
}

async function persistBookmarks(bookmarks: Bookmark[]) {
  if (stateCache) stateCache.bookmarks = bookmarks;
  await saveBookmarks(bookmarks);
}

async function persistCollections(collections: Collection[]) {
  if (stateCache) stateCache.collections = collections;
  await saveCollections(collections);
}

async function persistSettings(settings: AppSettings) {
  if (stateCache) stateCache.settings = settings;
  await saveSettings(settings);
}

// ─── Cached CRUD helpers ────────────────────────────────────────────────────

async function cachedAddBookmark(bookmark: Bookmark): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = [bookmark, ...state.bookmarks];
  await saveBookmarks(state.bookmarks);
  return state.bookmarks;
}

async function cachedUpdateBookmark(updated: Bookmark): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = state.bookmarks.map((b) => (b.id === updated.id ? updated : b));
  await saveBookmarks(state.bookmarks);
  return state.bookmarks;
}

async function cachedDeleteBookmark(id: string): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
  await Promise.all([saveBookmarks(state.bookmarks), recordTombstones('bookmarks', [id])]);
  return state.bookmarks;
}

async function cachedMoveToTrash(id: string): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = state.bookmarks.map((b) => {
    if (b.id !== id) return b;
    const previousCollectionId =
      b.collectionId === COLLECTION.TRASH
        ? b.previousCollectionId
        : b.collectionId;
    return {
      ...b,
      previousCollectionId,
      collectionId: COLLECTION.TRASH,
      updatedAt: Date.now(),
    };
  });
  await saveBookmarks(state.bookmarks);
  return state.bookmarks;
}

async function cachedRestoreFromTrash(id: string): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = state.bookmarks.map((b) => {
    if (b.id !== id) return b;
    const restoreTo =
      b.previousCollectionId && b.previousCollectionId !== COLLECTION.TRASH
        ? b.previousCollectionId
        : COLLECTION.UNSORTED;
    return {
      ...b,
      collectionId: restoreTo,
      previousCollectionId: undefined,
      updatedAt: Date.now(),
    };
  });
  await saveBookmarks(state.bookmarks);
  return state.bookmarks;
}

async function cachedAddCollection(collection: Collection): Promise<Collection[]> {
  const state = await ensureCache();
  state.collections = [...state.collections, collection];
  await saveCollections(state.collections);
  return state.collections;
}

async function cachedUpdateCollection(updated: Collection): Promise<Collection[]> {
  const state = await ensureCache();
  state.collections = state.collections.map((c) => (c.id === updated.id ? updated : c));
  await saveCollections(state.collections);
  return state.collections;
}

async function cachedDeleteCollection(id: string): Promise<[Collection[], Bookmark[]]> {
  const state = await ensureCache();
  const descendants = new Set<string>();
  descendants.add(id);
  let added = true;
  while (added) {
    added = false;
    for (const c of state.collections) {
      if (c.parentId && descendants.has(c.parentId) && !descendants.has(c.id)) {
        descendants.add(c.id);
        added = true;
      }
    }
  }
  const nextCollections = state.collections.filter((c) => !descendants.has(c.id));
  const nextBookmarks = state.bookmarks.map((b) =>
    descendants.has(b.collectionId)
      ? { ...b, collectionId: COLLECTION.UNSORTED, updatedAt: Date.now() }
      : b
  );
  await Promise.all([
    saveCollections(nextCollections),
    saveBookmarks(nextBookmarks),
    recordTombstones('collections', Array.from(descendants)),
  ]);
  state.collections = nextCollections;
  state.bookmarks = nextBookmarks;
  return [nextCollections, nextBookmarks];
}

// ─── Link Preview ───────────────────────────────────────────────────────────

/**
 * Resolve a preview image URL against its page and only accept safe http(s) URLs.
 * Rejects data:/javascript:/relative-to-private-host results.
 */
function resolveCoverUrl(candidate: string, pageUrl: string): string | undefined {
  try {
    const resolved = new URL(candidate, pageUrl).href;
    return isSafeBookmarkUrl(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a bookmark's page for preview metadata.
 * SSRF guard: `redirect: 'manual'` means a public URL that 30x-redirects to localhost /
 * 169.254.169.254 / an intranet host is never actually followed — the redirect is opaque
 * and we bail out instead of fetching the internal target.
 */
async function fetchLinkPreview(url: string): Promise<string | undefined> {
  if (!canFetchPreview(url)) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    // opaqueredirect (cross-origin 3xx) or any redirect → don't chase it.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return undefined;
    }
    if (!res.ok) return undefined;

    const reader = res.body?.getReader();
    if (!reader) return undefined;

    const decoder = new TextDecoder();
    let text = '';
    // The abort timer stays armed through the body read so a slow trickling
    // response can't keep the reader (and the service worker) alive indefinitely.
    while (text.length < 150000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel();

    const ogImageMatch =
      text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
    if (ogImageMatch?.[1]) {
      const resolved = resolveCoverUrl(ogImageMatch[1], url);
      if (resolved) return resolved;
    }

    const twitImageMatch =
      text.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/i);
    if (twitImageMatch?.[1]) {
      const resolved = resolveCoverUrl(twitImageMatch[1], url);
      if (resolved) return resolved;
    }
  } catch (error) {
    console.debug('Failed to fetch link preview for', url, error);
  } finally {
    clearTimeout(timer);
  }
  return undefined;
}

/** One bounded request with its own controller/timer. */
async function fetchWithTimeout(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkLinkStatus(url: string): Promise<number> {
  if (!canFetchPreview(url)) return 0;
  try {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, 'HEAD', 5000);
    } catch (err) {
      // Only retry with GET when HEAD is unsupported — not when we aborted (timeout).
      if (err instanceof DOMException && err.name === 'AbortError') return 0;
      // Fresh controller/timer for the fallback so it isn't racing an already-aborted signal.
      res = await fetchWithTimeout(url, 'GET', 5000);
    }
    // A redirect (opaque or 3xx) means the link is reachable, not broken.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return 200;
    }
    return res.status;
  } catch {
    return 0;
  }
}

async function togglePinBookmark(id: string): Promise<AppState> {
  const state = await ensureCache();
  const index = state.bookmarks.findIndex((b) => b.id === id);
  if (index !== -1) {
    const target = state.bookmarks[index];
    const updated: Bookmark = { ...target, pinned: !target.pinned, updatedAt: Date.now() };
    state.bookmarks = [
      ...state.bookmarks.slice(0, index),
      updated,
      ...state.bookmarks.slice(index + 1),
    ];
    await saveBookmarks(state.bookmarks);
  }
  return state;
}

async function getState(): Promise<AppState> {
  return ensureCache();
}

function normalizeTags(tags: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

// ─── Install / context menus / commands ─────────────────────────────────────

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'bm-save-page',
      title: 'Save to Bookmark Manager',
      contexts: ['page', 'link'],
    });
    chrome.contextMenus.create({
      id: 'bm-open-dashboard',
      title: 'Open Bookmark Manager',
      contexts: ['action'],
    });
  });
}

async function initGDriveAutoSync() {
  const meta = await loadGDriveMeta();
  const state = await ensureCache();
  const enabled = meta.connected && state.settings.gdriveAutoSync !== false && meta.autoSync;
  await ensureGDriveAlarm(enabled);
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  void emptyOldTrashIfNeeded().catch(() => undefined);
  void initGDriveAutoSync().catch(() => undefined);
});

/** Quiet (non-interactive) pull+push used by startup and the periodic alarm. */
async function runQuietAutoSync(): Promise<void> {
  try {
    const meta = await loadGDriveMeta();
    if (!meta.connected || meta.autoSync === false) return;
    const state = await ensureCache();
    if (state.settings.gdriveAutoSync === false) return;
    const synced = await syncWithGoogleDrive(state, { interactive: false });
    if (synced.result.ok) {
      await persistBookmarks(synced.bookmarks);
      await persistCollections(synced.collections);
      await persistSettings(synced.settings);
    }
  } catch (err) {
    console.debug('Quiet auto-sync failed', err);
  }
}

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  void emptyOldTrashIfNeeded().catch(() => undefined);
  void initGDriveAutoSync().catch(() => undefined);
  void runQuietAutoSync();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== GDRIVE_ALARM) return;
  void runQuietAutoSync();
});

async function emptyOldTrashIfNeeded() {
  const state = await ensureCache();
  const days = state.settings.trashAutoEmptyDays;
  if (!days || days <= 0) return;
  const cutoff = Date.now() - days * 86_400_000;
  const removedIds = state.bookmarks
    .filter((b) => b.collectionId === COLLECTION.TRASH && b.updatedAt < cutoff)
    .map((b) => b.id);
  if (removedIds.length === 0) return;
  const removed = new Set(removedIds);
  state.bookmarks = state.bookmarks.filter((b) => !removed.has(b.id));
  await Promise.all([saveBookmarks(state.bookmarks), recordTombstones('bookmarks', removedIds)]);
}

async function saveUrlAsBookmark(
  rawUrl: string,
  title: string,
  favicon?: string,
  forceUpdate = false
): Promise<Bookmark | null> {
  const url = sanitizeBookmarkUrl(rawUrl);
  if (!url) return null;

  const state = await ensureCache();
  const coverUrl = state.settings.fetchPreviews ? await fetchLinkPreview(url) : undefined;
  // Re-resolve after the (possibly slow) preview fetch so a concurrent edit/add
  // of the same URL isn't clobbered by a stale snapshot.
  const existing = findBookmarkByUrl(state.bookmarks, url);

  if (existing) {
    if (!forceUpdate && existing.collectionId !== COLLECTION.TRASH) {
      return existing;
    }
    const updated: Bookmark = {
      ...existing,
      title: title || existing.title,
      favicon: favicon || existing.favicon,
      updatedAt: Date.now(),
      coverUrl: existing.coverUrl || coverUrl,
      collectionId:
        existing.collectionId === COLLECTION.TRASH
          ? existing.previousCollectionId || COLLECTION.UNSORTED
          : existing.collectionId,
      previousCollectionId: undefined,
    };
    await cachedUpdateBookmark(updated);
    return updated;
  }

  const defaultCol =
    state.settings.defaultCollectionId &&
    state.settings.defaultCollectionId !== COLLECTION.ALL &&
    state.settings.defaultCollectionId !== COLLECTION.TRASH
      ? state.settings.defaultCollectionId
      : COLLECTION.UNSORTED;

  const bookmark: Bookmark = {
    id: generateId(),
    url,
    title: title || getDomain(url),
    favicon: favicon || getFavicon(url),
    tags: [],
    collectionId: defaultCol,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    coverUrl,
  };
  await cachedAddBookmark(bookmark);
  return bookmark;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'bm-open-dashboard') {
    await openDashboard();
    return;
  }
  if (info.menuItemId !== 'bm-save-page') return;

  const rawUrl = info.linkUrl ?? info.pageUrl ?? tab?.url ?? '';
  const title = info.linkUrl ? getDomain(info.linkUrl) : (tab?.title ?? '');
  const favicon = tab?.favIconUrl || getFavicon(rawUrl);
  await saveUrlAsBookmark(rawUrl, title, favicon, true);
  try {
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 1500);
  } catch {
    // ignore
  }
});

async function openDashboard() {
  const state = await ensureCache();
  if (state.settings.openInSidePanel && chrome.sidePanel?.open) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId != null) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        return;
      }
    } catch {
      // fall through
    }
  }
  const url = chrome.runtime.getURL('index.html?target=dashboard');
  await chrome.tabs.create({ url });
}

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'save-current-tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      await saveUrlAsBookmark(tab.url, tab.title || '', tab.favIconUrl, false);
      try {
        await chrome.action.setBadgeText({ text: '✓' });
        await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 1500);
      } catch {
        // ignore
      }
    }
  } else if (command === 'open-dashboard') {
    await openDashboard();
  }
});

// ─── Omnibox ────────────────────────────────────────────────────────────────

chrome.omnibox?.setDefaultSuggestion({
  description: 'Search bookmarks — type to filter by title, URL, or tags',
});

chrome.omnibox?.onInputChanged.addListener(async (text, suggest) => {
  const state = await ensureCache();
  const q = text.trim().toLowerCase();
  const hits = state.bookmarks
    .filter((b) => b.collectionId !== COLLECTION.TRASH)
    .filter(
      (b) =>
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.tags.some((t) => t.includes(q))
    )
    .slice(0, 6)
    .map((b) => ({
      content: b.url,
      description: `${escapeXml(b.title)} — <url>${escapeXml(b.url)}</url>`,
    }));
  suggest(hits);
});

chrome.omnibox?.onInputEntered.addListener((text, disposition) => {
  const url = text.startsWith('http')
    ? text
    : chrome.runtime.getURL(`index.html?target=dashboard&q=${encodeURIComponent(text)}`);
  if (disposition === 'currentTab') {
    chrome.tabs.update({ url });
  } else if (disposition === 'newForegroundTab') {
    chrome.tabs.create({ url });
  } else {
    chrome.tabs.create({ url, active: false });
  }
});

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Side panel default path
try {
  chrome.sidePanel?.setOptions?.({
    path: 'index.html?target=dashboard',
    enabled: true,
  });
} catch {
  // sidePanel may be unavailable in some builds
}

// ─── Message Handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'BM:getState': {
          sendResponse(await getState());
          break;
        }

        case 'BM:getSettings': {
          const state = await ensureCache();
          sendResponse(state.settings);
          break;
        }

        case 'BM:updateSettings': {
          const state = await ensureCache();
          const next = { ...state.settings, ...message.payload } as AppSettings;
          await persistSettings(next);
          if (message.payload && 'gdriveAutoSync' in message.payload) {
            const meta = await loadGDriveMeta();
            await ensureGDriveAlarm(
              meta.connected && next.gdriveAutoSync !== false
            );
          }
          sendResponse(await getState());
          break;
        }

        case 'BM:gdriveStatus': {
          sendResponse(await getGDriveStatus());
          break;
        }

        case 'BM:gdriveConnect': {
          try {
            const meta = await connectGDrive();
            const state = await ensureCache();
            // First connect: merge remote + local and upload
            const synced = await syncWithGoogleDrive(state);
            if (synced.result.ok) {
              await persistBookmarks(synced.bookmarks);
              await persistCollections(synced.collections);
              await persistSettings(synced.settings);
              await ensureGDriveAlarm(synced.settings.gdriveAutoSync !== false);
              sendResponse({
                ...(await getState()),
                gdrive: await getGDriveStatus(),
                gdriveSync: synced.result,
              });
            } else {
              await ensureGDriveAlarm(meta.autoSync !== false);
              sendResponse({
                ...(await getState()),
                gdrive: await getGDriveStatus(),
                error: synced.result.error || 'Sync failed after connect',
              });
            }
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : String(err) });
          }
          break;
        }

        case 'BM:gdriveDisconnect': {
          try {
            await disconnectGDrive();
            await ensureGDriveAlarm(false);
            sendResponse({
              ...(await getState()),
              gdrive: await getGDriveStatus(),
            });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : String(err) });
          }
          break;
        }

        case 'BM:gdriveSync': {
          try {
            const state = await ensureCache();
            const synced = await syncWithGoogleDrive(state);
            if (synced.result.ok) {
              await persistBookmarks(synced.bookmarks);
              await persistCollections(synced.collections);
              await persistSettings(synced.settings);
              await ensureGDriveAlarm(synced.settings.gdriveAutoSync !== false);
              sendResponse({
                ...(await getState()),
                gdrive: await getGDriveStatus(),
                gdriveSync: synced.result,
              });
            } else {
              sendResponse({
                ...(await getState()),
                gdrive: await getGDriveStatus(),
                error: synced.result.error || 'Sync failed',
              });
            }
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : String(err) });
          }
          break;
        }

        case 'BM:findDuplicate': {
          const state = await ensureCache();
          const url = sanitizeBookmarkUrl(String(message.url || ''));
          const found = url ? findBookmarkByUrl(state.bookmarks, url) : undefined;
          sendResponse({ duplicate: found ?? null });
          break;
        }

        case 'BM:addBookmark': {
          const payload = message.payload as Omit<
            Bookmark,
            'id' | 'createdAt' | 'updatedAt' | 'coverUrl' | 'pinned'
          > & { id?: string };
          const safeUrl = sanitizeBookmarkUrl(payload.url);
          if (!safeUrl) {
            sendResponse({ error: 'Invalid or unsupported bookmark URL' });
            break;
          }

          const state = await ensureCache();
          const existing =
            (payload.id ? state.bookmarks.find((b) => b.id === payload.id) : undefined) ||
            findBookmarkByUrl(state.bookmarks, safeUrl);

          if (existing) {
            const updated: Bookmark = {
              ...existing,
              ...payload,
              url: safeUrl,
              tags: normalizeTags(payload.tags ?? existing.tags),
              updatedAt: Date.now(),
              coverUrl: existing.coverUrl,
            };
            await cachedUpdateBookmark(updated);
            sendResponse(await getState());
            break;
          }

          const coverUrl = state.settings.fetchPreviews
            ? await fetchLinkPreview(safeUrl)
            : undefined;

          // A concurrent add of the same URL may have landed during the preview fetch.
          const raced = findBookmarkByUrl(state.bookmarks, safeUrl);
          if (raced) {
            await cachedUpdateBookmark({
              ...raced,
              ...payload,
              url: safeUrl,
              tags: normalizeTags(payload.tags ?? raced.tags),
              updatedAt: Date.now(),
              coverUrl: raced.coverUrl || coverUrl,
            });
            sendResponse(await getState());
            break;
          }

          const bookmark: Bookmark = {
            ...payload,
            url: safeUrl,
            id: generateId(),
            tags: normalizeTags(payload.tags),
            favicon: payload.favicon || getFavicon(safeUrl),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            coverUrl,
            pinned: false,
          };
          await cachedAddBookmark(bookmark);
          sendResponse(await getState());
          break;
        }

        case 'BM:updateBookmark': {
          const payload = message.payload as Partial<Bookmark> & { id: string };
          const state = await ensureCache();
          const existing = state.bookmarks.find((b) => b.id === payload.id);
          if (!existing) {
            sendResponse({ error: 'Bookmark not found' });
            break;
          }

          const nextUrl = payload.url != null ? sanitizeBookmarkUrl(payload.url) : existing.url;
          if (!nextUrl) {
            sendResponse({ error: 'Invalid or unsupported bookmark URL' });
            break;
          }

          await cachedUpdateBookmark({
            ...existing,
            ...payload,
            id: existing.id,
            url: nextUrl,
            // Explicitly keep user-edited title (don't fall back to tab/page title).
            title:
              typeof payload.title === 'string' && payload.title.trim()
                ? payload.title.trim()
                : existing.title,
            note: payload.note !== undefined ? payload.note : existing.note,
            tags: payload.tags != null ? normalizeTags(payload.tags) : existing.tags,
            collectionId: payload.collectionId ?? existing.collectionId,
            favicon: payload.favicon || existing.favicon,
            updatedAt: Date.now(),
          });
          sendResponse(await getState());
          break;
        }

        case 'BM:deleteBookmark': {
          await cachedDeleteBookmark(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkDelete': {
          const ids = message.ids as string[];
          const idSet = new Set(ids);
          const state = await ensureCache();
          state.bookmarks = state.bookmarks.filter((b) => !idSet.has(b.id));
          await Promise.all([saveBookmarks(state.bookmarks), recordTombstones('bookmarks', ids)]);
          sendResponse(await getState());
          break;
        }

        case 'BM:moveToTrash': {
          await cachedMoveToTrash(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkMoveToTrash': {
          const ids = new Set(message.ids as string[]);
          const state = await ensureCache();
          state.bookmarks = state.bookmarks.map((b) => {
            if (!ids.has(b.id)) return b;
            return {
              ...b,
              previousCollectionId:
                b.collectionId === COLLECTION.TRASH ? b.previousCollectionId : b.collectionId,
              collectionId: COLLECTION.TRASH,
              updatedAt: Date.now(),
            };
          });
          await saveBookmarks(state.bookmarks);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkMove': {
          const { ids, collectionId } = message.payload as {
            ids: string[];
            collectionId: string;
          };
          if (collectionId === COLLECTION.ALL) {
            sendResponse({ error: 'Cannot move to All' });
            break;
          }
          const idSet = new Set(ids);
          const state = await ensureCache();
          if (collectionId === COLLECTION.TRASH) {
            state.bookmarks = state.bookmarks.map((b) => {
              if (!idSet.has(b.id)) return b;
              return {
                ...b,
                previousCollectionId:
                  b.collectionId === COLLECTION.TRASH ? b.previousCollectionId : b.collectionId,
                collectionId: COLLECTION.TRASH,
                updatedAt: Date.now(),
              };
            });
          } else {
            state.bookmarks = state.bookmarks.map((b) =>
              idSet.has(b.id)
                ? {
                    ...b,
                    collectionId,
                    previousCollectionId: undefined,
                    updatedAt: Date.now(),
                  }
                : b
            );
          }
          await saveBookmarks(state.bookmarks);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkTag': {
          const { ids, add = [], remove = [] } = message.payload as {
            ids: string[];
            add?: string[];
            remove?: string[];
          };
          const idSet = new Set(ids);
          const addN = normalizeTags(add);
          const removeN = new Set(normalizeTags(remove));
          const state = await ensureCache();
          state.bookmarks = state.bookmarks.map((b) => {
            if (!idSet.has(b.id)) return b;
            let tags = b.tags.filter((t) => !removeN.has(t));
            for (const t of addN) {
              if (!tags.includes(t)) tags = [...tags, t];
            }
            return { ...b, tags, updatedAt: Date.now() };
          });
          await saveBookmarks(state.bookmarks);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkPin': {
          const { ids, pinned } = message.payload as { ids: string[]; pinned: boolean };
          const idSet = new Set(ids);
          const state = await ensureCache();
          state.bookmarks = state.bookmarks.map((b) =>
            idSet.has(b.id) ? { ...b, pinned, updatedAt: Date.now() } : b
          );
          await saveBookmarks(state.bookmarks);
          sendResponse(await getState());
          break;
        }

        case 'BM:restoreFromTrash': {
          await cachedRestoreFromTrash(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:togglePin': {
          sendResponse(await togglePinBookmark(message.id as string));
          break;
        }

        case 'BM:addCollection': {
          const payload = message.payload as Omit<Collection, 'id' | 'createdAt' | 'updatedAt'>;
          const now = Date.now();
          const collection: Collection = {
            ...payload,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
          };
          await cachedAddCollection(collection);
          sendResponse(await getState());
          break;
        }

        case 'BM:updateCollection': {
          const payload = message.payload as Collection;
          await cachedUpdateCollection({
            ...payload,
            updatedAt: Date.now(),
          });
          sendResponse(await getState());
          break;
        }

        case 'BM:deleteCollection': {
          await cachedDeleteCollection(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:importBrowser': {
          const tree = await chrome.bookmarks.getTree();
          const state = await ensureCache();
          const existingUrls = new Set(state.bookmarks.map((b) => b.url));
          const nameToId = new Map<string, string>();
          for (const c of state.collections) {
            nameToId.set(`${c.parentId || ''}::${c.name.toLowerCase()}`, c.id);
          }

          const newBookmarks: Bookmark[] = [];
          const newCollections: Collection[] = [];

          function ensureCollection(name: string, parentId?: string): string {
            const key = `${parentId || ''}::${name.toLowerCase()}`;
            const existingId = nameToId.get(key);
            if (existingId) return existingId;
            const found = [...state.collections, ...newCollections].find(
              (c) =>
                c.name.toLowerCase() === name.toLowerCase() &&
                (c.parentId || undefined) === (parentId || undefined)
            );
            if (found) {
              nameToId.set(key, found.id);
              return found.id;
            }
            const col: Collection = {
              id: generateId(),
              name,
              icon: 'folder',
              color: 'blue',
              createdAt: Date.now(),
              parentId,
            };
            newCollections.push(col);
            nameToId.set(key, col.id);
            return col.id;
          }

          function traverse(
            nodes: chrome.bookmarks.BookmarkTreeNode[],
            parentCollectionId?: string
          ) {
            for (const node of nodes) {
              if (node.url) {
                if (existingUrls.has(node.url)) continue;
                const safe = sanitizeBookmarkUrl(node.url);
                if (!safe) continue;
                existingUrls.add(safe);
                newBookmarks.push({
                  id: generateId(),
                  url: safe,
                  title: node.title || getDomain(safe),
                  favicon: getFavicon(safe),
                  tags: [],
                  collectionId: parentCollectionId || COLLECTION.UNSORTED,
                  createdAt: node.dateAdded ?? Date.now(),
                  updatedAt: Date.now(),
                  pinned: false,
                });
              } else if (node.children) {
                // Skip synthetic root; map folder nodes to collections
                const isRoot = !node.parentId;
                if (isRoot) {
                  traverse(node.children, parentCollectionId);
                } else {
                  const folderName = node.title?.trim() || 'Imported';
                  const colId = ensureCollection(folderName, parentCollectionId);
                  traverse(node.children, colId);
                }
              }
            }
          }

          traverse(tree);
          state.collections = [...state.collections, ...newCollections];
          state.bookmarks = [...newBookmarks, ...state.bookmarks];
          await Promise.all([
            saveCollections(state.collections),
            saveBookmarks(state.bookmarks),
          ]);
          sendResponse({
            ...(await getState()),
            imported: newBookmarks.length,
            importedCollections: newCollections.length,
          });
          break;
        }

        case 'BM:importData': {
          const { bookmarks, collections } = message.payload as {
            bookmarks: Bookmark[];
            collections: Collection[];
          };
          const state = await ensureCache();

          const sanitizedBookmarks = (Array.isArray(bookmarks) ? bookmarks : [])
            .map((bookmark): Bookmark | null => {
              const safeUrl = sanitizeBookmarkUrl(bookmark?.url || '');
              if (!safeUrl || typeof bookmark?.id !== 'string') return null;
              return {
                ...bookmark,
                url: safeUrl,
                title: typeof bookmark.title === 'string' ? bookmark.title : getDomain(safeUrl),
                favicon:
                  typeof bookmark.favicon === 'string' ? bookmark.favicon : getFavicon(safeUrl),
                tags: normalizeTags(bookmark.tags),
                note: typeof bookmark.note === 'string' ? bookmark.note : undefined,
                collectionId:
                  typeof bookmark.collectionId === 'string'
                    ? bookmark.collectionId
                    : COLLECTION.UNSORTED,
                createdAt: typeof bookmark.createdAt === 'number' ? bookmark.createdAt : Date.now(),
                updatedAt: typeof bookmark.updatedAt === 'number' ? bookmark.updatedAt : Date.now(),
                pinned: Boolean(bookmark.pinned),
                coverUrl:
                  typeof bookmark.coverUrl === 'string' && isSafeBookmarkUrl(bookmark.coverUrl)
                    ? bookmark.coverUrl
                    : undefined,
                previousCollectionId:
                  typeof bookmark.previousCollectionId === 'string'
                    ? bookmark.previousCollectionId
                    : undefined,
                linkStatus:
                  typeof bookmark.linkStatus === 'number' ? bookmark.linkStatus : bookmark.linkStatus,
                lastCheckedAt:
                  typeof bookmark.lastCheckedAt === 'number' ? bookmark.lastCheckedAt : undefined,
              } satisfies Bookmark;
            })
            .filter((bookmark): bookmark is Bookmark => bookmark !== null);

          const sanitizedCollections = (Array.isArray(collections) ? collections : [])
            .filter(
              (collection) =>
                collection && typeof collection.id === 'string' && typeof collection.name === 'string'
            )
            .map((collection) => ({
              ...collection,
              parentId: typeof collection.parentId === 'string' ? collection.parentId : undefined,
            }));

          for (const b of sanitizedBookmarks) {
            const idx = state.bookmarks.findIndex((x) => x.id === b.id);
            if (idx >= 0) {
              state.bookmarks = [
                ...state.bookmarks.slice(0, idx),
                b,
                ...state.bookmarks.slice(idx + 1),
              ];
            } else {
              state.bookmarks = [...state.bookmarks, b];
            }
          }

          for (const c of sanitizedCollections) {
            const idx = state.collections.findIndex((x) => x.id === c.id);
            if (idx >= 0) {
              state.collections = [
                ...state.collections.slice(0, idx),
                c,
                ...state.collections.slice(idx + 1),
              ];
            } else {
              state.collections = [...state.collections, c];
            }
          }

          await Promise.all([
            saveBookmarks(state.bookmarks),
            saveCollections(state.collections),
          ]);
          sendResponse(await getState());
          break;
        }

        case 'BM:getCurrentTab': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({
            url: tab?.url ?? '',
            title: tab?.title ?? '',
            favicon: tab?.favIconUrl ?? (tab?.url ? getFavicon(tab.url) : ''),
          });
          break;
        }

        case 'BM:refreshPreviews': {
          const state = await ensureCache();
          const toUpdate = state.bookmarks.filter((b) => !b.coverUrl);
          const coverUpdates = new Map<string, string>();
          const batchSize = 5;
          for (let i = 0; i < toUpdate.length; i += batchSize) {
            const batch = toUpdate.slice(i, i + batchSize);
            await Promise.all(
              batch.map(async (b) => {
                const coverUrl = await fetchLinkPreview(b.url);
                if (coverUrl) coverUpdates.set(b.id, coverUrl);
              })
            );
            if (coverUpdates.size > 0) {
              state.bookmarks = state.bookmarks.map((b) =>
                coverUpdates.has(b.id) ? { ...b, coverUrl: coverUpdates.get(b.id) } : b
              );
              await saveBookmarks(state.bookmarks);
            }
          }
          sendResponse(await getState());
          break;
        }

        case 'BM:checkBrokenLinks': {
          const state = await ensureCache();
          const ids = message.payload?.ids as string[] | undefined;
          const targets = state.bookmarks.filter(
            (b) =>
              b.collectionId !== COLLECTION.TRASH &&
              (!ids || ids.includes(b.id))
          );
          const batchSize = 4;
          const statusMap = new Map<string, number>();
          for (let i = 0; i < targets.length; i += batchSize) {
            const batch = targets.slice(i, i + batchSize);
            await Promise.all(
              batch.map(async (b) => {
                const status = await checkLinkStatus(b.url);
                statusMap.set(b.id, status);
              })
            );
            const now = Date.now();
            state.bookmarks = state.bookmarks.map((b) =>
              statusMap.has(b.id)
                ? { ...b, linkStatus: statusMap.get(b.id)!, lastCheckedAt: now }
                : b
            );
            await saveBookmarks(state.bookmarks);
          }
          sendResponse(await getState());
          break;
        }

        case 'BM:emptyOldTrash': {
          // emptyOldTrashIfNeeded already removes expired-trash bookmarks and records tombstones.
          await emptyOldTrashIfNeeded();
          sendResponse(await getState());
          break;
        }

        case 'BM:saveBookmarks': {
          const payload = message.payload as Bookmark[];
          if (Array.isArray(payload)) {
            await persistBookmarks(payload);
            sendResponse(await getState());
          } else {
            sendResponse({ error: 'Invalid bookmarks array' });
          }
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ error: String(err) });
    }
  })();

  return true;
});

// Keep the in-memory cache coherent with storage. Update in place from the new value
// rather than nulling the cache: nulling forces a re-read and, worse, opens a window where
// a concurrent handler rebuilds the cache from disk mid-mutation. This also no-ops cheaply
// for the service worker's own writes instead of thrashing.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !stateCache) return;
  const nextBookmarks = changes.bm_bookmarks?.newValue;
  if (Array.isArray(nextBookmarks)) stateCache.bookmarks = nextBookmarks as Bookmark[];
  const nextCollections = changes.bm_collections?.newValue;
  if (Array.isArray(nextCollections)) stateCache.collections = nextCollections as Collection[];
  const nextSettings = changes.bm_settings?.newValue;
  if (nextSettings && typeof nextSettings === 'object') {
    stateCache.settings = { ...DEFAULT_SETTINGS, ...(nextSettings as Partial<AppSettings>) };
  }
});
