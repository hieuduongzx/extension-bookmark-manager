// ─── Domain Types ────────────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon: string;
  tags: string[];
  collectionId: string; // smart | 'unsorted' | 'trash' | custom UUID
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  coverUrl?: string;
  note?: string;
  order?: number;
  /** Collection before trash — used when restoring */
  previousCollectionId?: string;
  /** HTTP status from last link check (0 = network error) */
  linkStatus?: number | null;
  lastCheckedAt?: number;
}

export type CollectionId = string;

export interface Collection {
  id: string;
  name: string;
  icon: CollectionIcon;
  color: CollectionColor;
  createdAt: number;
  /** Used for Google Drive last-write-wins merge */
  updatedAt?: number;
  parentId?: string;
  pinned?: boolean;
}

export type CollectionIcon =
  | 'folder'
  | 'star'
  | 'heart'
  | 'briefcase'
  | 'book'
  | 'code'
  | 'music'
  | 'film'
  | 'shopping-cart'
  | 'globe'
  | 'bookmark'
  | 'sparkles'
  | 'wrench'
  | 'graduation-cap'
  | 'newspaper'
  | 'gamepad';

export type CollectionColor =
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'rose'
  | 'orange'
  | 'amber'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'pink';

export type ThemeMode = 'light' | 'dark' | 'system';
export type LocaleCode = 'en' | 'vi';
export type ViewMode = 'grid' | 'list' | 'masonry' | 'folder';
export type SortOrder = 'newest' | 'oldest' | 'a-z' | 'z-a' | 'domain' | 'updated';

export interface AppSettings {
  theme: ThemeMode;
  locale: LocaleCode;
  defaultCollectionId: string;
  defaultSort: SortOrder;
  defaultViewMode: ViewMode;
  fetchPreviews: boolean;
  trashAutoEmptyDays: number; // 0 = disabled
  openInSidePanel: boolean;
  showQuickSave: boolean;
  /** Periodic Google Drive sync when connected */
  gdriveAutoSync: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  locale: 'en',
  defaultCollectionId: '__unsorted__',
  defaultSort: 'newest',
  defaultViewMode: 'list',
  fetchPreviews: true,
  trashAutoEmptyDays: 30,
  openInSidePanel: false,
  showQuickSave: true,
  gdriveAutoSync: true,
};

// ─── Message Types ────────────────────────────────────────────────────────────

export type Message =
  | { type: 'BM:getState' }
  | { type: 'BM:addBookmark'; payload: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } }
  | { type: 'BM:updateBookmark'; payload: Partial<Bookmark> & { id: string } }
  | { type: 'BM:deleteBookmark'; id: string }
  | { type: 'BM:moveToTrash'; id: string }
  | { type: 'BM:restoreFromTrash'; id: string }
  | { type: 'BM:togglePin'; id: string }
  | { type: 'BM:bulkDelete'; ids: string[] }
  | { type: 'BM:bulkMoveToTrash'; ids: string[] }
  | { type: 'BM:bulkRestore'; ids: string[] }
  | { type: 'BM:bulkMove'; payload: { ids: string[]; collectionId: string } }
  | { type: 'BM:bulkTag'; payload: { ids: string[]; add?: string[]; remove?: string[] } }
  | { type: 'BM:bulkPin'; payload: { ids: string[]; pinned: boolean } }
  | { type: 'BM:addCollection'; payload: Omit<Collection, 'id' | 'createdAt'> }
  | { type: 'BM:updateCollection'; payload: Partial<Collection> & { id: string } }
  | { type: 'BM:deleteCollection'; id: string }
  | { type: 'BM:renameTag'; payload: { oldTag: string; newTag: string } }
  | { type: 'BM:deleteTag'; tag: string }
  | { type: 'BM:saveAllTabs'; payload?: { collectionName?: string; collectionId?: string } }
  | { type: 'BM:importBrowser' }
  | { type: 'BM:importData'; payload: { bookmarks: Bookmark[]; collections: Collection[] } }
  | { type: 'BM:getCurrentTab' }
  | { type: 'BM:refreshPreviews' }
  | { type: 'BM:saveBookmarks'; payload: Bookmark[] }
  | { type: 'BM:getSettings' }
  | { type: 'BM:updateSettings'; payload: Partial<AppSettings> }
  | { type: 'BM:checkBrokenLinks'; payload?: { ids?: string[] } }
  | { type: 'BM:emptyOldTrash' }
  | { type: 'BM:emptyTrash' }
  | { type: 'BM:findDuplicate'; url: string }
  | { type: 'BM:gdriveStatus' }
  | { type: 'BM:gdriveConnect' }
  | { type: 'BM:gdriveDisconnect' }
  | { type: 'BM:gdriveSync' };

export interface AppState {
  bookmarks: Bookmark[];
  collections: Collection[];
  settings: AppSettings;
}

// ─── Smart Collection IDs ─────────────────────────────────────────────────────

export const COLLECTION = {
  ALL: '__all__',
  UNSORTED: '__unsorted__',
  TRASH: '__trash__',
} as const;

export const SMART = {
  PINNED: '__smart_pinned__',
  UNTAGGED: '__smart_untagged__',
  WITH_NOTES: '__smart_with_notes__',
  NO_COVER: '__smart_no_cover__',
  THIS_WEEK: '__smart_this_week__',
  BROKEN: '__smart_broken__',
  DUPLICATES: '__smart_duplicates__',
} as const;

export type SmartCollectionId = (typeof SMART)[keyof typeof SMART];

export function isSmartCollection(id: string): id is SmartCollectionId {
  return Object.values(SMART).includes(id as SmartCollectionId);
}

export function isSystemCollection(id: string): boolean {
  return (
    id === COLLECTION.ALL ||
    id === COLLECTION.UNSORTED ||
    id === COLLECTION.TRASH ||
    isSmartCollection(id)
  );
}
