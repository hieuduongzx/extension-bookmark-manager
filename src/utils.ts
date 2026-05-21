import type { Collection } from './types';

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
