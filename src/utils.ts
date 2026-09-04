import type { Bookmark, Collection, ThemeMode } from './types';
import { COLLECTION, SMART, isSmartCollection } from './types';

// --- URL Helpers --------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/i,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isSafeBookmarkUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return !!parsed && ALLOWED_PROTOCOLS.has(parsed.protocol);
}

export function canFetchPreview(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.trim();
  if (!hostname) {
    return false;
  }

  return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function sanitizeBookmarkUrl(url: string): string | null {
  const trimmed = url.trim();
  return isSafeBookmarkUrl(trimmed) ? trimmed : null;
}

/**
 * Canonical form for "is this the same page?" checks.
 * Strips hash, normalizes trailing slash + www, lowercases host.
 * Keeps path, query, and protocol so different pages don't collide.
 */
export function canonicalizeUrlForMatch(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Prefer href without default ports
    return u.href;
  } catch {
    return url.trim();
  }
}

/** Find a bookmark for the given URL. Prefers non-trash matches. */
export function findBookmarkByUrl(
  bookmarks: Bookmark[],
  url: string
): Bookmark | undefined {
  if (!url) return undefined;
  const target = canonicalizeUrlForMatch(url);
  let trashMatch: Bookmark | undefined;
  for (const b of bookmarks) {
    if (canonicalizeUrlForMatch(b.url) !== target) continue;
    if (b.collectionId !== COLLECTION.TRASH) return b;
    trashMatch = trashMatch ?? b;
  }
  return trashMatch;
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function getFavicon(url: string): string {
  try {
    const { origin } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch {
    return '';
  }
}

// Inline SVG fallback for when the favicon network request fails.
// Avoids third-party calls (ui-avatars.com) on error.
const FALLBACK_PALETTE = [
  '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#10b981', '#14b8a6', '#06b6d4',
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getFaviconFallback(url: string): string {
  const host = getDomain(url) || url || '?';
  const letter = host.charAt(0).toUpperCase() || '?';
  const color = FALLBACK_PALETTE[hashString(host) % FALLBACK_PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${color}"/><text x="16" y="21" font-family="-apple-system,Segoe UI,sans-serif" font-size="16" font-weight="600" text-anchor="middle" fill="white">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Auto-prepend https:// when user types a bare domain.
// Returns the original string unchanged if it already has a scheme,
// is an empty string, or doesn't look like a hostname.
export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  // Heuristic: looks like a hostname or hostname/path
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed) || /^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

// --- Date Helpers -------------------------------------------------------------

export function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60_000;
  const h = 3_600_000;
  const d = 86_400_000;

  if (diff < m) return 'Just now';
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;

  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- ID Generator -------------------------------------------------------------

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// --- Tag parsing --------------------------------------------------------------

export function parseTags(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(Boolean);
}

/**
 * Tags used across bookmarks in a collection (including descendant collections),
 * sorted by how often they're used (desc), then alphabetically.
 * Empty when the collection has no tagged bookmarks or isn't a real folder.
 */
export function getCollectionTags(
  bookmarks: Bookmark[],
  collections: Collection[],
  collectionId: string
): string[] {
  if (!collectionId || collectionId === COLLECTION.ALL || collectionId === COLLECTION.TRASH) {
    return [];
  }

  const ids = new Set<string>([collectionId]);
  const stack = [collectionId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const c of collections) {
      if (c.parentId === id && !ids.has(c.id)) {
        ids.add(c.id);
        stack.push(c.id);
      }
    }
  }

  const counts = new Map<string, number>();
  for (const b of bookmarks) {
    if (!ids.has(b.collectionId)) continue;
    for (const tag of b.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

// --- Collection Hierarchy -----------------------------------------------------

export interface CollectionNode extends Collection {
  children: CollectionNode[];
  depth: number;
}

export function buildCollectionTree(collections: Collection[], parentId?: string, depth = 0): CollectionNode[] {
  return collections
    .filter(c => c.parentId === parentId)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.name.localeCompare(b.name))
    .map(c => ({
      ...c,
      depth,
      children: buildCollectionTree(collections, c.id, depth + 1)
    }));
}

export function flattenCollectionTree(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.reduce((acc, node) => {
    return [...acc, node, ...flattenCollectionTree(node.children)];
  }, [] as CollectionNode[]);
}

export function getCollectionDescendants(collections: Collection[], id: string): Set<string> {
  const descendants = new Set<string>();
  const children = collections.filter(c => c.parentId === id);
  for (const child of children) {
    descendants.add(child.id);
    const childDescendants = getCollectionDescendants(collections, child.id);
    childDescendants.forEach(d => descendants.add(d));
  }
  return descendants;
}

// Fast cached version for repeated lookups with same collections array
export function buildDescendantsMap(collections: Collection[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of collections) {
    map.set(c.id, getCollectionDescendants(collections, c.id));
  }
  return map;
}

// --- Search operators ---------------------------------------------------------
// Supports: tag:foo site:example.com in:work note:text  + free-text
// Free text matches title, url, tags, and notes (case-insensitive substring / fuzzy).

export interface ParsedSearch {
  text: string;
  tags: string[];
  site?: string;
  inName?: string;
  note?: string;
}

export function parseSearchQuery(raw: string): ParsedSearch {
  const tags: string[] = [];
  let site: string | undefined;
  let inName: string | undefined;
  let note: string | undefined;
  const textParts: string[] = [];

  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const unquoted = token.replace(/^"|"$/g, '');
    const lower = unquoted.toLowerCase();
    if (lower.startsWith('tag:')) {
      const t = unquoted.slice(4).trim().toLowerCase().replace(/^#/, '');
      if (t) tags.push(t);
    } else if (lower.startsWith('site:')) {
      site = unquoted.slice(5).trim().toLowerCase().replace(/^www\./, '');
    } else if (lower.startsWith('in:')) {
      inName = unquoted.slice(3).trim().toLowerCase();
    } else if (lower.startsWith('note:')) {
      note = unquoted.slice(5).trim().toLowerCase();
    } else {
      textParts.push(unquoted);
    }
  }

  return { text: textParts.join(' ').trim(), tags, site, inName, note };
}

/** Simple fuzzy: all characters of query appear in order in target */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function matchesSearch(
  bookmark: Bookmark,
  parsed: ParsedSearch,
  collections: Collection[]
): boolean {
  if (parsed.tags.length > 0) {
    if (!parsed.tags.every((tag) => bookmark.tags.includes(tag))) return false;
  }
  if (parsed.site) {
    const domain = getDomain(bookmark.url).toLowerCase();
    if (!domain.includes(parsed.site)) return false;
  }
  if (parsed.inName) {
    const col = collections.find((c) => c.id === bookmark.collectionId);
    const name = (col?.name ?? (bookmark.collectionId === COLLECTION.UNSORTED ? 'unsorted' : '')).toLowerCase();
    if (!name.includes(parsed.inName)) return false;
  }
  if (parsed.note) {
    if (!(bookmark.note || '').toLowerCase().includes(parsed.note)) return false;
  }
  if (parsed.text) {
    const hay = `${bookmark.title} ${bookmark.url} ${bookmark.tags.join(' ')} ${bookmark.note || ''}`;
    if (!fuzzyMatch(parsed.text, hay)) return false;
  }
  return true;
}

export function filterBySmartCollection(bookmarks: Bookmark[], smartId: string): Bookmark[] {
  const weekAgo = Date.now() - 7 * 86_400_000;
  switch (smartId) {
    case SMART.PINNED:
      return bookmarks.filter((b) => b.pinned && b.collectionId !== COLLECTION.TRASH);
    case SMART.UNTAGGED:
      return bookmarks.filter((b) => b.tags.length === 0 && b.collectionId !== COLLECTION.TRASH);
    case SMART.NO_COVER:
      return bookmarks.filter((b) => !b.coverUrl && b.collectionId !== COLLECTION.TRASH);
    case SMART.THIS_WEEK:
      return bookmarks.filter((b) => b.createdAt >= weekAgo && b.collectionId !== COLLECTION.TRASH);
    case SMART.BROKEN:
      return bookmarks.filter(
        (b) =>
          b.collectionId !== COLLECTION.TRASH &&
          typeof b.linkStatus === 'number' &&
          (b.linkStatus === 0 || b.linkStatus >= 400)
      );
    default:
      return bookmarks;
  }
}

export function isBrokenLink(b: Bookmark): boolean {
  return typeof b.linkStatus === 'number' && (b.linkStatus === 0 || b.linkStatus >= 400);
}

// --- Theme --------------------------------------------------------------------

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.dataset.theme = resolved;
}

export { isSmartCollection };
