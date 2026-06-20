import {
  saveBookmarks,
  saveCollections,
  getInitialState,
} from './storage';
import { COLLECTION, type AppState, type Bookmark, type Collection } from './types';
import { canFetchPreview, generateId, getDomain, getFavicon, isSafeBookmarkUrl, sanitizeBookmarkUrl } from './utils';

// ─── In-Memory State Cache ──────────────────────────────────────────────────
// Background script is a single service worker; caching eliminates redundant
// storage reads on every message.

let stateCache: AppState | null = null;

async function ensureCache(): Promise<AppState> {
  if (!stateCache) {
    stateCache = await getInitialState();
  }
  return stateCache;
}

function invalidateCache() {
  stateCache = null;
}

async function persistBookmarks(bookmarks: Bookmark[]) {
  if (stateCache) stateCache.bookmarks = bookmarks;
  await saveBookmarks(bookmarks);
}

async function persistCollections(collections: Collection[]) {
  if (stateCache) stateCache.collections = collections;
  await saveCollections(collections);
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
  await saveBookmarks(state.bookmarks);
  return state.bookmarks;
}

async function cachedMoveToTrash(id: string): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = state.bookmarks.map((b) =>
    b.id === id ? { ...b, collectionId: COLLECTION.TRASH, updatedAt: Date.now() } : b
  );
  await saveBookmarks(state.bookmarks);
  return state.bookmarks;
}

async function cachedRestoreFromTrash(id: string): Promise<Bookmark[]> {
  const state = await ensureCache();
  state.bookmarks = state.bookmarks.map((b) =>
    b.id === id ? { ...b, collectionId: COLLECTION.UNSORTED, updatedAt: Date.now() } : b
  );
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
    descendants.has(b.collectionId) ? { ...b, collectionId: COLLECTION.UNSORTED, updatedAt: Date.now() } : b
  );
  await Promise.all([saveCollections(nextCollections), saveBookmarks(nextBookmarks)]);
  state.collections = nextCollections;
  state.bookmarks = nextBookmarks;
  return [nextCollections, nextBookmarks];
}

// ─── Link Preview ───────────────────────────────────────────────────────────

async function fetchLinkPreview(url: string): Promise<string | undefined> {
  if (!canFetchPreview(url)) {
    return undefined;
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);

    if (!res.ok) return undefined;

    const reader = res.body?.getReader();
    if (!reader) return undefined;

    const decoder = new TextDecoder();
    let text = '';
    while (text.length < 150000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel();

    const ogImageMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                         text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);

    if (ogImageMatch && ogImageMatch[1]) {
      if (ogImageMatch[1].startsWith('/')) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${ogImageMatch[1]}`;
      }
      return ogImageMatch[1];
    }

    const twitImageMatch = text.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                           text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/i);
    if (twitImageMatch && twitImageMatch[1]) {
      if (twitImageMatch[1].startsWith('/')) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${twitImageMatch[1]}`;
      }
      return twitImageMatch[1];
    }
  } catch (error) {
    console.debug('Failed to fetch link preview for', url, error);
  }
  return undefined;
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

// ─── State helper ─────────────────────────────────────────────────────────────

async function getState(): Promise<AppState> {
  return ensureCache();
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'bm-save-page',
    title: 'Save to Bookmark Manager',
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'bm-save-page') return;

  const rawUrl = info.linkUrl ?? info.pageUrl ?? tab?.url ?? '';
  const url = sanitizeBookmarkUrl(rawUrl);
  if (!url) return;

  const title = info.linkUrl ? getDomain(info.linkUrl) : (tab?.title ?? '');
  const favicon = getFavicon(url);

  const coverUrl = await fetchLinkPreview(url);

  const state = await ensureCache();
  const existing = state.bookmarks.find(b => b.url === url);

  if (existing) {
    const updated: Bookmark = {
      ...existing,
      updatedAt: Date.now(),
      coverUrl: existing.coverUrl || coverUrl,
    };
    await cachedUpdateBookmark(updated);
    return;
  }

  const bookmark: Bookmark = {
    id: generateId(),
    url,
    title,
    favicon,
    tags: [],
    collectionId: COLLECTION.UNSORTED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    coverUrl
  };

  await cachedAddBookmark(bookmark);
});

// ─── Message Handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'BM:getState': {
          sendResponse(await getState());
          break;
        }

        case 'BM:addBookmark': {
          const payload = message.payload as Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt' | 'coverUrl' | 'pinned'>;
          const safeUrl = sanitizeBookmarkUrl(payload.url);
          if (!safeUrl) {
            sendResponse({ error: 'Invalid or unsupported bookmark URL' });
            break;
          }

          const coverUrl = await fetchLinkPreview(safeUrl);

          const bookmark: Bookmark = {
            ...payload,
            url: safeUrl,
            id: generateId(),
            tags: Array.from(new Set((payload.tags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
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
          const payload = message.payload as Bookmark;
          const safeUrl = sanitizeBookmarkUrl(payload.url);
          if (!safeUrl) {
            sendResponse({ error: 'Invalid or unsupported bookmark URL' });
            break;
          }

          await cachedUpdateBookmark({
            ...payload,
            url: safeUrl,
            tags: Array.from(new Set((payload.tags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
            updatedAt: Date.now()
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
          const state = await ensureCache();
          state.bookmarks = state.bookmarks.filter(b => !ids.includes(b.id));
          await saveBookmarks(state.bookmarks);
          sendResponse({ ...state, bookmarks: state.bookmarks });
          break;
        }

        case 'BM:moveToTrash': {
          await cachedMoveToTrash(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkMoveToTrash': {
          const ids = message.ids as string[];
          const state = await ensureCache();
          state.bookmarks = state.bookmarks.map(b => ids.includes(b.id) ? { ...b, collectionId: COLLECTION.TRASH, updatedAt: Date.now() } : b);
          await saveBookmarks(state.bookmarks);
          sendResponse({ ...state, bookmarks: state.bookmarks });
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
          const payload = message.payload as Omit<Collection, 'id' | 'createdAt'>;
          const collection: Collection = {
            ...payload,
            id: generateId(),
            createdAt: Date.now(),
          };
          await cachedAddCollection(collection);
          sendResponse(await getState());
          break;
        }

        case 'BM:updateCollection': {
          const payload = message.payload as Collection;
          await cachedUpdateCollection(payload);
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

          const newBookmarks: Bookmark[] = [];

          function traverse(nodes: chrome.bookmarks.BookmarkTreeNode[]) {
            for (const node of nodes) {
              if (node.url && !existingUrls.has(node.url)) {
                newBookmarks.push({
                  id: generateId(),
                  url: node.url,
                  title: node.title || getDomain(node.url),
                  favicon: getFavicon(node.url),
                  tags: [],
                  collectionId: COLLECTION.UNSORTED,
                  createdAt: node.dateAdded ?? Date.now(),
                  updatedAt: Date.now(),
                  pinned: false,
                });
              }
              if (node.children) traverse(node.children);
            }
          }

          traverse(tree);
          state.bookmarks = [...newBookmarks, ...state.bookmarks];
          await saveBookmarks(state.bookmarks);
          sendResponse({ ...state, imported: newBookmarks.length });
          break;
        }

        case 'BM:importData': {
          const { bookmarks, collections } = message.payload as { bookmarks: Bookmark[], collections: Collection[] };
          const state = await ensureCache();

          const sanitizedBookmarks = (Array.isArray(bookmarks) ? bookmarks : [])
            .map((bookmark): Bookmark | null => {
              const safeUrl = sanitizeBookmarkUrl(bookmark?.url || '');
              if (!safeUrl || typeof bookmark?.id !== 'string') {
                return null;
              }

              return {
                ...bookmark,
                url: safeUrl,
                title: typeof bookmark.title === 'string' ? bookmark.title : getDomain(safeUrl),
                favicon: typeof bookmark.favicon === 'string' ? bookmark.favicon : getFavicon(safeUrl),
                tags: Array.from(new Set((Array.isArray(bookmark.tags) ? bookmark.tags : []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
                note: typeof bookmark.note === 'string' ? bookmark.note : undefined,
                collectionId: typeof bookmark.collectionId === 'string' ? bookmark.collectionId : COLLECTION.UNSORTED,
                createdAt: typeof bookmark.createdAt === 'number' ? bookmark.createdAt : Date.now(),
                updatedAt: typeof bookmark.updatedAt === 'number' ? bookmark.updatedAt : Date.now(),
                pinned: Boolean(bookmark.pinned),
                coverUrl: typeof bookmark.coverUrl === 'string' && isSafeBookmarkUrl(bookmark.coverUrl) ? bookmark.coverUrl : undefined,
              } satisfies Bookmark;
            })
            .filter((bookmark): bookmark is Bookmark => bookmark !== null);

          const sanitizedCollections = (Array.isArray(collections) ? collections : [])
            .filter((collection) => collection && typeof collection.id === 'string' && typeof collection.name === 'string')
            .map((collection) => ({
              ...collection,
              parentId: typeof collection.parentId === 'string' ? collection.parentId : undefined,
            }));

          for (const b of sanitizedBookmarks) {
            const idx = state.bookmarks.findIndex(x => x.id === b.id);
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
            const idx = state.collections.findIndex(x => x.id === c.id);
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

          await Promise.all([saveBookmarks(state.bookmarks), saveCollections(state.collections)]);
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
          const toUpdate = state.bookmarks.filter(b => !b.coverUrl);

          const coverUpdates = new Map<string, string>();
          const batchSize = 5;
          for (let i = 0; i < toUpdate.length; i += batchSize) {
            const batch = toUpdate.slice(i, i + batchSize);
            await Promise.all(batch.map(async (b) => {
              const coverUrl = await fetchLinkPreview(b.url);
              if (coverUrl) coverUpdates.set(b.id, coverUrl);
            }));

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

        case 'BM:saveBookmarks': {
          const payload = message.payload as Bookmark[];
          if (Array.isArray(payload)) {
            await saveBookmarks(payload);
            stateCache = null; // invalidate cache
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

  return true; // keep channel open for async
});
