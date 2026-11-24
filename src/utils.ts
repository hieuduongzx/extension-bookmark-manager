import type { Bookmark, Collection, LocaleCode, ThemeMode } from './types';
import { COLLECTION, SMART, isSmartCollection } from './types';

// --- URL Helpers --------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const LOCALHOST_PATTERN = /(^|\.)localhost$/i;

/** Parse one dotted-quad octet allowing decimal (127), hex (0x7f) and octal (0177) forms. */
function parseIpv4Octet(part: string): number | null {
  if (/^0[xX][0-9a-fA-F]{1,8}$/.test(part)) return parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return parseInt(part.slice(1), 8);
  if (/^\d{1,3}$/.test(part)) return parseInt(part, 10);
  return null;
}

/** Parse a dotted-quad host into a 32-bit number, or null if it isn't one. */
function ipv4ToNumber(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = parseIpv4Octet(part);
    if (n === null || n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function isPrivateIpv4(n: number): boolean {
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10/8, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

/** Parse an IPv6 literal (either `::ffff:127.0.0.1` or canonical `::ffff:7f00:1`
 *  form — the URL parser serializes to the latter) into 8 hextets, or null. */
function parseIpv6(host: string): number[] | null {
  let h = host;
  // Rewrite an embedded dotted-quad suffix into two hextets.
  const lastColon = h.lastIndexOf(':');
  if (lastColon !== -1 && h.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToNumber(h.slice(lastColon + 1));
    if (v4 === null) return null;
    h =
      h.slice(0, lastColon + 1) +
      `${(v4 >>> 16) & 0xffff}:${v4 & 0xffff}`;
  }
  const sections = h.split('::');
  if (sections.length > 2) return null;
  const head = sections[0] ? sections[0].split(':').filter(Boolean) : [];
  const tail = sections.length === 2 ? (sections[1] ? sections[1].split(':').filter(Boolean) : []) : [];
  const total = head.length + tail.length;
  let groups: string[];
  if (sections.length === 2) {
    const fill = 8 - total;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    if (total !== 8) return null;
    groups = head;
  }
  const hextets = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (hextets.some((n) => Number.isNaN(n))) return null;
  return hextets;
}

function isPrivateIpv6(host: string): boolean {
  const groups = parseIpv6(host);
  // Unparseable → treat as private (fail closed).
  if (!groups) return true;
  // :: (unspecified) and ::1 (loopback)
  if (groups.every((g) => g === 0)) return true;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) — evaluate the embedded IPv4.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return isPrivateIpv4((((groups[6] << 16) | groups[7]) >>> 0));
  }
  if (groups.slice(0, 6).every((g) => g === 0)) {
    const v4 = ((groups[6] << 16) | groups[7]) >>> 0;
    if (v4 !== 0) return isPrivateIpv4(v4);
  }
  // ULA fc00::/7
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  return false;
}

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

  const hostname = parsed.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return false;
  }

  // Whole-address integer literals: http://2130706433/ and http://0x7f000001/
  if (/^\d{1,10}$/.test(hostname)) {
    const n = parseInt(hostname, 10);
    return n <= 0xffffffff ? !isPrivateIpv4(n) : false;
  }
  if (/^0x[0-9a-f]{1,8}$/.test(hostname)) {
    return !isPrivateIpv4(parseInt(hostname.slice(2), 16));
  }

  if (hostname.includes(':')) {
    return !isPrivateIpv6(hostname);
  }

  const ipv4 = ipv4ToNumber(hostname);
  if (ipv4 !== null) {
    return !isPrivateIpv4(ipv4);
  }

  return !LOCALHOST_PATTERN.test(hostname);
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

// ─── Related (sub-URL) bookkeeping ─────────────────────────────────────────────
// A saved bookmark A is a "root" of URL B when they share a host and B's path is
// nested under A's path (or shares the path with a different query string).
// The site homepage ('' or '/') is never a root — everything would be its child.

interface UrlParts {
  host: string;
  path: string;
  query: string;
}

function splitUrlParts(url: string): UrlParts | null {
  try {
    const u = new URL(url.trim());
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return {
      host: u.hostname.toLowerCase().replace(/^www\./, ''),
      path,
      query: u.search,
    };
  } catch {
    return null;
  }
}

function isPathChildOf(childPath: string, parentPath: string): boolean {
  if (parentPath === '' || parentPath === '/') return false;
  return childPath.startsWith(`${parentPath}/`);
}

/**
 * Saved bookmarks (excluding `excludeId` and trash) that the given URL is a
 * sub-URL of — e.g. already saved `site.com/guide` and checking `site.com/guide/part-2`.
 * Sorted so the closest ancestor (longest path) comes first.
 */
export function findRelatedRootBookmarks(
  bookmarks: Bookmark[],
  url: string,
  excludeId?: string
): Bookmark[] {
  const parts = splitUrlParts(url);
  if (!parts) return [];
  const roots = bookmarks.filter((b) => {
    if (b.id === excludeId || b.collectionId === COLLECTION.TRASH) return false;
    const bp = splitUrlParts(b.url);
    if (!bp || bp.host !== parts.host) return false;
    if (canonicalizeUrlForMatch(b.url) === canonicalizeUrlForMatch(url)) return false;
    return isPathChildOf(parts.path, bp.path);
  });
  return roots.sort((a, b) => {
    const pa = splitUrlParts(a.url)?.path.length ?? 0;
    const pb = splitUrlParts(b.url)?.path.length ?? 0;
    return pb - pa;
  });
}

/**
 * Map of bookmark id → its closest saved ancestor bookmark (same host, shorter
 * path that prefixes it; same-path-different-query also counts). Used to badge
 * sub-page cards in the list. Bookmarks in trash are neither badged nor roots.
 */
export function buildRelatedRootsMap(bookmarks: Bookmark[]): Map<string, Bookmark> {
  const byHost = new Map<string, { bookmark: Bookmark; path: string }[]>();
  for (const b of bookmarks) {
    if (b.collectionId === COLLECTION.TRASH) continue;
    const parts = splitUrlParts(b.url);
    if (!parts) continue;
    const list = byHost.get(parts.host) ?? [];
    list.push({ bookmark: b, path: parts.path });
    byHost.set(parts.host, list);
  }
  for (const list of byHost.values()) {
    // Longest paths first so the first prefix hit is the closest ancestor.
    list.sort((a, b) => b.path.length - a.path.length);
  }

  const map = new Map<string, Bookmark>();
  for (const b of bookmarks) {
    if (b.collectionId === COLLECTION.TRASH) continue;
    const parts = splitUrlParts(b.url);
    if (!parts) continue;
    const siblings = byHost.get(parts.host);
    if (!siblings) continue;
    for (const { bookmark: candidate, path } of siblings) {
      if (candidate.id === b.id) continue;
      // The ancestor's path must be strictly shorter and prefix ours — same
      // path with a different query is a duplicate, not a parent/child relation.
      if (path.length >= parts.path.length) continue;
      if (!isPathChildOf(parts.path, path)) continue;
      map.set(b.id, candidate);
      break;
    }
  }
  return map;
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

export function formatRelativeDate(ts: number, locale: LocaleCode = 'en'): string {
  const diff = Date.now() - ts;
  const m = 60_000;
  const h = 3_600_000;
  const d = 86_400_000;

  if (locale === 'vi') {
    if (diff < m) return 'Vừa xong';
    if (diff < h) return `${Math.floor(diff / m)} phút trước`;
    if (diff < d) return `${Math.floor(diff / h)} giờ trước`;
    if (diff < 7 * d) return `${Math.floor(diff / d)} ngày trước`;
    return new Date(ts).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  if (diff < m) return 'Just now';
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;

  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Deterministic muted surface tint for Grid cards that lack a cover image.
const COVER_TINTS = [
  'bg-sky-50/70 dark:bg-sky-950/25 text-sky-600/70 dark:text-sky-400/70',
  'bg-indigo-50/70 dark:bg-indigo-950/25 text-indigo-600/70 dark:text-indigo-400/70',
  'bg-violet-50/70 dark:bg-violet-950/25 text-violet-600/70 dark:text-violet-400/70',
  'bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-600/70 dark:text-emerald-400/70',
  'bg-teal-50/70 dark:bg-teal-950/25 text-teal-600/70 dark:text-teal-400/70',
  'bg-amber-50/70 dark:bg-amber-950/25 text-amber-600/70 dark:text-amber-400/70',
  'bg-rose-50/70 dark:bg-rose-950/25 text-rose-600/70 dark:text-rose-400/70',
  'bg-slate-100/80 dark:bg-zinc-800/70 text-slate-500/80 dark:text-zinc-400/70',
];

export function getDomainCoverTint(url: string): string {
  const host = getDomain(url) || url || '?';
  return COVER_TINTS[hashString(host) % COVER_TINTS.length];
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

export function buildCollectionTree(collections: Collection[]): CollectionNode[] {
  // A collection whose parentId points at a non-existent collection (orphaned by
  // an import / sync edge case) is surfaced at the root instead of vanishing.
  const ids = new Set(collections.map((c) => c.id));
  const rootOf = (c: Collection): string | undefined =>
    c.parentId && ids.has(c.parentId) ? c.parentId : undefined;
  const build = (parentId: string | undefined, depth: number): CollectionNode[] =>
    collections
      .filter((c) => rootOf(c) === parentId)
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.name.localeCompare(b.name))
      .map((c) => ({
        ...c,
        depth,
        children: build(c.id, depth + 1),
      }));
  return build(undefined, 0);
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

/** Ancestor trail from root down to `id` (inclusive), safe against parent cycles. */
export function getCollectionPath(collections: Collection[], id: string): Collection[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const trail: Collection[] = [];
  const seen = new Set<string>();
  let curr = byId.get(id);
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    trail.unshift(curr);
    curr = curr.parentId ? byId.get(curr.parentId) : undefined;
  }
  return trail;
}

/** Return IDs of all non-trash bookmarks that share a canonical URL with at least one other bookmark. */
export function findDuplicateBookmarkIds(bookmarks: Bookmark[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const b of bookmarks) {
    if (b.collectionId === COLLECTION.TRASH) continue;
    const key = canonicalizeUrlForMatch(b.url);
    const list = groups.get(key);
    if (list) list.push(b.id);
    else groups.set(key, [b.id]);
  }
  const dupIds = new Set<string>();
  for (const ids of groups.values()) {
    if (ids.length > 1) {
      for (const id of ids) dupIds.add(id);
    }
  }
  return dupIds;
}

// --- Search operators ---------------------------------------------------------
// Supports: tag:foo -tag:bar site:example.com in:work note:text
//           is:pinned is:broken is:untagged has:note has:cover + free-text
// Free text matches title, url, tags, and notes (case-insensitive substring / fuzzy).

export interface ParsedSearch {
  text: string;
  tags: string[];
  excludeTags: string[];
  site?: string;
  inName?: string;
  note?: string;
  isPinned?: boolean;
  isBroken?: boolean;
  isUntagged?: boolean;
  hasNote?: boolean;
  hasCover?: boolean;
}

export function parseSearchQuery(raw: string): ParsedSearch {
  const tags: string[] = [];
  const excludeTags: string[] = [];
  let site: string | undefined;
  let inName: string | undefined;
  let note: string | undefined;
  let isPinned: boolean | undefined;
  let isBroken: boolean | undefined;
  let isUntagged: boolean | undefined;
  let hasNote: boolean | undefined;
  let hasCover: boolean | undefined;
  const textParts: string[] = [];

  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const unquoted = token.replace(/^"|"$/g, '');
    const lower = unquoted.toLowerCase();
    if (lower.startsWith('tag:')) {
      const t = unquoted.slice(4).trim().toLowerCase().replace(/^#/, '');
      if (t) tags.push(t);
    } else if (lower.startsWith('-tag:')) {
      const t = unquoted.slice(5).trim().toLowerCase().replace(/^#/, '');
      if (t) excludeTags.push(t);
    } else if (lower.startsWith('site:')) {
      site = unquoted.slice(5).trim().toLowerCase().replace(/^www\./, '');
    } else if (lower.startsWith('in:')) {
      inName = unquoted.slice(3).trim().toLowerCase();
    } else if (lower.startsWith('note:')) {
      note = unquoted.slice(5).trim().toLowerCase();
    } else if (lower === 'is:pinned') {
      isPinned = true;
    } else if (lower === 'is:broken') {
      isBroken = true;
    } else if (lower === 'is:untagged') {
      isUntagged = true;
    } else if (lower === 'has:note') {
      hasNote = true;
    } else if (lower === 'has:cover') {
      hasCover = true;
    } else {
      textParts.push(unquoted);
    }
  }

  return {
    text: textParts.join(' ').trim(),
    tags,
    excludeTags,
    site,
    inName,
    note,
    isPinned,
    isBroken,
    isUntagged,
    hasNote,
    hasCover,
  };
}

export function hasSearchOperators(parsed: ParsedSearch): boolean {
  return Boolean(
    parsed.text ||
      parsed.tags.length ||
      parsed.excludeTags.length ||
      parsed.site ||
      parsed.inName ||
      parsed.note ||
      parsed.isPinned ||
      parsed.isBroken ||
      parsed.isUntagged ||
      parsed.hasNote ||
      parsed.hasCover
  );
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
  if (parsed.excludeTags.length > 0) {
    if (parsed.excludeTags.some((tag) => bookmark.tags.includes(tag))) return false;
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
  if (parsed.isPinned && !bookmark.pinned) return false;
  if (parsed.isBroken && !isBrokenLink(bookmark)) return false;
  if (parsed.isUntagged && bookmark.tags.length > 0) return false;
  if (parsed.hasNote && !(bookmark.note && bookmark.note.trim())) return false;
  if (parsed.hasCover && !bookmark.coverUrl) return false;
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
    case SMART.WITH_NOTES:
      return bookmarks.filter(
        (b) => Boolean(b.note && b.note.trim()) && b.collectionId !== COLLECTION.TRASH
      );
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
    case SMART.DUPLICATES: {
      const dupIds = findDuplicateBookmarkIds(bookmarks);
      return bookmarks.filter((b) => dupIds.has(b.id));
    }
    default:
      return bookmarks;
  }
}

export function isBrokenLink(b: Bookmark): boolean {
  return typeof b.linkStatus === 'number' && (b.linkStatus === 0 || b.linkStatus >= 400);
}

// --- Netscape HTML Bookmark Import / Export -----------------------------------

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function exportBookmarksToHtml(bookmarks: Bookmark[], collections: Collection[]): string {
  const nonTrash = bookmarks.filter((b) => b.collectionId !== COLLECTION.TRASH);
  const tree = buildCollectionTree(collections);
  const byCollection = new Map<string, Bookmark[]>();
  for (const b of nonTrash) {
    const list = byCollection.get(b.collectionId) ?? [];
    list.push(b);
    byCollection.set(b.collectionId, list);
  }

  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  const renderBookmark = (b: Bookmark, indent: string) => {
    const addDate = Math.floor((b.createdAt || Date.now()) / 1000);
    const tagsAttr = b.tags.length > 0 ? ` TAGS="${escapeHtmlAttr(b.tags.join(','))}"` : '';
    lines.push(
      `${indent}<DT><A HREF="${escapeHtmlAttr(b.url)}" ADD_DATE="${addDate}"${tagsAttr}>${escapeHtmlAttr(b.title || getDomain(b.url))}</A>`
    );
    if (b.note && b.note.trim()) {
      lines.push(`${indent}<DD>${escapeHtmlAttr(b.note.trim())}`);
    }
  };

  const renderNode = (node: CollectionNode, depth: number) => {
    const indent = '  '.repeat(depth);
    const addDate = Math.floor((node.createdAt || Date.now()) / 1000);
    lines.push(`${indent}<DT><H3 ADD_DATE="${addDate}">${escapeHtmlAttr(node.name)}</H3>`);
    lines.push(`${indent}<DL><p>`);
    const items = byCollection.get(node.id) ?? [];
    for (const b of items) renderBookmark(b, '  '.repeat(depth + 1));
    for (const child of node.children) renderNode(child, depth + 1);
    lines.push(`${indent}</DL><p>`);
  };

  for (const node of tree) renderNode(node, 1);

  const unsorted = byCollection.get(COLLECTION.UNSORTED) ?? [];
  for (const b of unsorted) renderBookmark(b, '  ');

  lines.push('</DL><p>');
  return lines.join('\n');
}

export function parseNetscapeBookmarksHtml(html: string): {
  bookmarks: Bookmark[];
  collections: Collection[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const bookmarks: Bookmark[] = [];
  const collections: Collection[] = [];
  const now = Date.now();

  const walkDl = (dl: Element, parentId?: string) => {
    const children = Array.from(dl.children);
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (el.tagName !== 'DT') continue;

      const h3 = el.querySelector(':scope > h3, :scope > H3');
      if (h3) {
        const name = (h3.textContent || '').trim() || 'Imported';
        const colId = generateId();
        const addDateAttr = h3.getAttribute('add_date');
        const createdAt = addDateAttr ? Number(addDateAttr) * 1000 || now : now;
        collections.push({
          id: colId,
          name,
          icon: 'folder',
          color: 'blue',
          createdAt,
          updatedAt: now,
          parentId,
        });
        // Nested DL may be inside DT or the next sibling
        const nestedDl =
          el.querySelector(':scope > dl, :scope > DL') ||
          (children[i + 1]?.tagName === 'DL' ? children[i + 1] : null);
        if (nestedDl) walkDl(nestedDl, colId);
        continue;
      }

      const anchor = el.querySelector(':scope > a, :scope > A');
      if (anchor) {
        const rawHref = anchor.getAttribute('href') || '';
        const safeUrl = sanitizeBookmarkUrl(rawHref);
        if (!safeUrl) continue;
        const addDateAttr = anchor.getAttribute('add_date');
        const createdAt = addDateAttr ? Number(addDateAttr) * 1000 || now : now;
        const tagsAttr = anchor.getAttribute('tags') || '';
        const tags = tagsAttr ? parseTags(tagsAttr) : [];
        let note: string | undefined;
        const nextEl = children[i + 1];
        if (nextEl?.tagName === 'DD' && nextEl.textContent?.trim()) {
          note = nextEl.textContent.trim();
        }
        bookmarks.push({
          id: generateId(),
          url: safeUrl,
          title: (anchor.textContent || '').trim() || getDomain(safeUrl),
          favicon: getFavicon(safeUrl),
          tags,
          note,
          collectionId: parentId || COLLECTION.UNSORTED,
          createdAt,
          updatedAt: now,
          pinned: false,
        });
      }
    }
  };

  const rootDl = doc.querySelector('dl, DL');
  if (rootDl) walkDl(rootDl);
  return { bookmarks, collections };
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
