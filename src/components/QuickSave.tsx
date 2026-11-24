import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  CornerDownRight,
  ExternalLink,
  Folder,
  FolderOpen,
  Globe,
  Hash,
  LayoutGrid,
  Maximize2,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type { AppSettings, Bookmark, Collection } from '../types';
import { COLLECTION } from '../types';
import {
  buildCollectionTree,
  findBookmarkByUrl,
  findRelatedRootBookmarks,
  flattenCollectionTree,
  fuzzyMatch,
  getCollectionTags,
  getDomain,
  getFavicon,
  getFaviconFallback,
  normalizeUrlInput,
} from '../utils';
import { createT } from '../i18n';
import { getCollectionColorText, getCollectionIcon } from '../collectionIcons';
import { Dropdown } from './Dropdown';
import { Button } from './ui/Button';
import { DriveStatusDot, ReauthBanner } from './ui/DriveStatus';
import type { GDriveUiStatus } from '../driveSync';

type PopupTab = 'save' | 'browse';

interface QuickSaveProps {
  bookmarks: Bookmark[];
  collections: Collection[];
  settings: AppSettings;
  allTags: string[];
  onSave: (
    data: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
  onOpenLibrary: (collectionId?: string) => void;
  onOpenDashboard: () => void;
  onOpenPreferences?: () => void;
  onOpenGDrive?: () => void;
  onSyncGDrive?: () => void;
  gdrive?: GDriveUiStatus | null;
  onQuickAddCollection?: (name: string) => Promise<string | void>;
  onClose?: () => void;
}

export function QuickSave({
  bookmarks,
  collections,
  settings,
  allTags,
  onSave,
  onRemove,
  onOpenLibrary,
  onOpenDashboard,
  onOpenPreferences,
  onOpenGDrive,
  onSyncGDrive,
  gdrive = null,
  onQuickAddCollection,
}: QuickSaveProps) {
  const t = useMemo(() => createT(settings.locale), [settings.locale]);
  const [activeTab, setActiveTab] = useState<PopupTab>('save');
  const [browseQuery, setBrowseQuery] = useState('');

  const [url, setUrl] = useState('');
  const [isManualUrl, setIsManualUrl] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagInputFocused, setTagInputFocused] = useState(false);
  const [collectionId, setCollectionId] = useState(
    settings.defaultCollectionId || COLLECTION.UNSORTED
  );
  const [editingId, setEditingId] = useState<string | undefined>();
  const [favicon, setFavicon] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);

  const didHydrateRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef({
    title: '',
    note: '',
    tags: [] as string[],
    pinned: false,
    collectionId: '',
    editingId: undefined as string | undefined,
    url: '',
    favicon: '',
  });
  formRef.current = { title, note, tags, pinned, collectionId, editingId, url, favicon };

  useEffect(() => {
    if (didHydrateRef.current) return;

    let cancelled = false;

    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (cancelled || didHydrateRef.current) return;
      didHydrateRef.current = true;

      const tab = tabs[0];
      if (
        !tab?.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://')
      ) {
        setIsManualUrl(true);
        setHydrated(true);
        return;
      }

      setIsManualUrl(false);
      const existing = findBookmarkByUrl(bookmarks, tab.url);
      if (existing) {
        setUrl(existing.url);
        setTitle(existing.title);
        setNote(existing.note || '');
        setTags([...existing.tags]);
        setPinned(Boolean(existing.pinned));
        setCollectionId(
          existing.collectionId === COLLECTION.TRASH
            ? existing.previousCollectionId || COLLECTION.UNSORTED
            : existing.collectionId
        );
        setEditingId(existing.id);
        setFavicon(existing.favicon || tab.favIconUrl || getFavicon(existing.url));
        requestAnimationFrame(() => {
          titleInputRef.current?.focus();
          titleInputRef.current?.select();
        });
      } else {
        setUrl(tab.url);
        setTitle(tab.title || '');
        setFavicon(tab.favIconUrl || getFavicon(tab.url));
        setEditingId(undefined);
        setNote('');
        setTags([]);
        setPinned(false);
        const def = settings.defaultCollectionId;
        if (def && def !== COLLECTION.ALL && def !== COLLECTION.TRASH) {
          setCollectionId(def);
        } else {
          setCollectionId(COLLECTION.UNSORTED);
        }
      }
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot hydrate
  }, [bookmarks, settings.defaultCollectionId]);

  const nonTrashBookmarks = useMemo(
    () => bookmarks.filter((b) => b.collectionId !== COLLECTION.TRASH),
    [bookmarks]
  );

  const collectionTree = useMemo(
    () => flattenCollectionTree(buildCollectionTree(collections)),
    [collections]
  );

  const collectionOptions = useMemo(
    () => [
      { value: COLLECTION.UNSORTED, label: t('unsorted') },
      ...collectionTree.map((c) => ({
        value: c.id,
        label: c.name,
        depth: c.depth,
      })),
    ],
    [collectionTree, t]
  );

  const collectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of nonTrashBookmarks) {
      map.set(b.collectionId, (map.get(b.collectionId) || 0) + 1);
    }
    return map;
  }, [nonTrashBookmarks]);

  const filteredBrowseCollections = useMemo(() => {
    const q = browseQuery.trim();
    if (!q) return collectionTree;
    return collectionTree.filter((c) => fuzzyMatch(q, c.name));
  }, [collectionTree, browseQuery]);

  const filteredBrowseBookmarks = useMemo(() => {
    const q = browseQuery.trim();
    const sorted = [...nonTrashBookmarks].sort(
      (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt - a.createdAt
    );
    if (!q) return sorted.slice(0, 6);
    return sorted
      .filter((b) => fuzzyMatch(q, `${b.title} ${b.url} ${b.tags.join(' ')}`))
      .slice(0, 10);
  }, [nonTrashBookmarks, browseQuery]);

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name || !onQuickAddCollection) {
      setIsCreatingCollection(false);
      setNewCollectionName('');
      return;
    }
    setCreatingCollection(true);
    try {
      const id = await onQuickAddCollection(name);
      if (typeof id === 'string' && id) {
        setCollectionId(id);
      } else {
        const matches = collections.filter((c) => c.name === name);
        if (matches.length > 0) {
          const newest = matches.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
          setCollectionId(newest.id);
        }
      }
      setIsCreatingCollection(false);
      setNewCollectionName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create collection');
    } finally {
      setCreatingCollection(false);
    }
  };

  const isEditMode = Boolean(editingId);

  const duplicate = useMemo(() => {
    if (isEditMode) return null;
    const normalized = normalizeUrlInput(url);
    if (!normalized) return null;
    const found = findBookmarkByUrl(bookmarks, normalized);
    return found && found.id !== editingId ? found : null;
  }, [url, bookmarks, editingId, isEditMode]);

  const relatedRoots = useMemo(() => {
    if (isEditMode || duplicate) return [];
    const normalized = normalizeUrlInput(url);
    if (!normalized) return [];
    return findRelatedRootBookmarks(bookmarks, normalized, editingId).slice(0, 3);
  }, [url, bookmarks, editingId, isEditMode, duplicate]);

  const collectionTags = useMemo(
    () => getCollectionTags(bookmarks, collections, collectionId),
    [bookmarks, collections, collectionId]
  );

  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase().replace(/^#/, '');
    const coll = collectionTags.filter((tag) => !tags.includes(tag) && (!q || tag.includes(q)));
    const rest = allTags.filter(
      (tag) => !tags.includes(tag) && !coll.includes(tag) && (!q || tag.includes(q))
    );
    return (tagInputFocused || q ? [...coll, ...rest] : []).slice(0, 6);
  }, [collectionTags, allTags, tags, tagInput, tagInputFocused]);

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/^#/, '');
    if (!tag || tags.includes(tag)) return;
    setTags((prev) => [...prev, tag]);
    setTagInput('');
  };

  const handleSave = async () => {
    const form = formRef.current;
    const normalized = normalizeUrlInput(form.url);
    if (!normalized) {
      setError('Invalid URL');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const matched = findBookmarkByUrl(bookmarks, normalized);
      const targetId = form.editingId || duplicate?.id || matched?.id;
      const nextTitle = form.title.trim() || getDomain(normalized);
      await onSave({
        ...(targetId ? { id: targetId } : {}),
        url: normalized,
        title: nextTitle,
        note: form.note,
        tags: form.tags,
        pinned: form.pinned,
        favicon: form.favicon || getFavicon(normalized),
        collectionId: form.collectionId || COLLECTION.UNSORTED,
      });
      setSaved(true);
      setTimeout(() => window.close(), 650);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!editingId || !onRemove) return;
    setIsSaving(true);
    try {
      await onRemove(editingId);
      setTimeout(() => window.close(), 400);
    } finally {
      setIsSaving(false);
    }
  };

  const enterEditFromDuplicate = (existing: Bookmark) => {
    setUrl(existing.url);
    setTitle(existing.title);
    setNote(existing.note || '');
    setTags([...existing.tags]);
    setPinned(Boolean(existing.pinned));
    setCollectionId(
      existing.collectionId === COLLECTION.TRASH
        ? existing.previousCollectionId || COLLECTION.UNSORTED
        : existing.collectionId
    );
    setEditingId(existing.id);
    setFavicon(existing.favicon || favicon || getFavicon(existing.url));
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  };

  const driveTitle = gdrive?.needsReauth
    ? t('gdriveStatusNeedsReauth')
    : gdrive?.busy
      ? t('gdriveSyncing')
      : gdrive?.connected
        ? `${t('gdriveStatusSynced')}${gdrive.email ? ` · ${gdrive.email}` : ''}`
        : t('gdriveMenuTitle');

  const subtitleText = t('popupSubtitle', {
    bookmarks: String(nonTrashBookmarks.length),
    collections: String(collections.length),
  });

  const normalizedPreviewUrl = normalizeUrlInput(url);

  return (
    <div
      className="popup-shell"
      onKeyDown={(e) => {
        if (
          activeTab === 'save' &&
          (e.ctrlKey || e.metaKey) &&
          e.key === 'Enter' &&
          !isSaving &&
          normalizedPreviewUrl &&
          hydrated &&
          !saved
        ) {
          e.preventDefault();
          void handleSave();
        }
      }}
    >
      {/* 1. Fixed 1-line Header (*2k standard) */}
      <header className="popup-header">
        <div className="popup-brand">
          <img
            src={chrome.runtime.getURL('public/icons/icon-48.png')}
            alt="Bookmark Manager"
            className="popup-logo"
          />
          <div className="popup-brand-info">
            <div className="popup-title-row">
              <span className="popup-title">{t('appBrand')}</span>
              {(onOpenGDrive || onSyncGDrive) && (
                <DriveStatusDot
                  gdrive={gdrive}
                  title={driveTitle}
                  onClick={() => {
                    if (gdrive?.connected && !gdrive.needsReauth && onSyncGDrive) {
                      onSyncGDrive();
                    } else if (onOpenGDrive) {
                      onOpenGDrive();
                    }
                  }}
                />
              )}
            </div>
            <div className="popup-subtitle">{subtitleText}</div>
          </div>
        </div>

        <div className="popup-header-actions">
          {gdrive?.connected && !gdrive.needsReauth && onSyncGDrive && (
            <button
              type="button"
              className="popup-icon-btn"
              onClick={onSyncGDrive}
              disabled={gdrive.busy}
              title={t('gdriveMenuSync')}
              aria-label={t('gdriveMenuSync')}
            >
              <RefreshCw size={15} className={gdrive.busy ? 'ui-spin' : ''} />
            </button>
          )}
          <button
            type="button"
            className="popup-icon-btn"
            onClick={onOpenDashboard}
            title={t('openDashboard')}
            aria-label={t('openDashboard')}
          >
            <Maximize2 size={15} />
          </button>
          {onOpenPreferences && (
            <button
              type="button"
              className="popup-icon-btn"
              onClick={onOpenPreferences}
              title={t('settings')}
              aria-label={t('settings')}
            >
              <Settings size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Drive needs_reauth Banner (*2k standard) */}
      {gdrive?.needsReauth && onOpenGDrive && (
        <ReauthBanner
          message={t('popupReauthBanner')}
          actionLabel={t('gdriveReconnect')}
          busy={gdrive.busy}
          onAction={onOpenGDrive}
        />
      )}

      {/* 2. Segmented 2-Tab Bar (*2k standard) */}
      <div className="popup-tabs-wrap">
        <div className="popup-tabs" role="tablist" aria-label="Popup navigation">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'save'}
            className={`popup-tab ${activeTab === 'save' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('save')}
          >
            <BookmarkPlus size={13} />
            <span>{t('popupTabSave')}</span>
            {isEditMode && (
              <span className="popup-tab-pill popup-tab-pill--accent">{t('savedBadge')}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'browse'}
            className={`popup-tab ${activeTab === 'browse' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            <Folder size={13} />
            <span>{t('popupTabBrowse')}</span>
            <span className="popup-tab-pill popup-tab-pill--muted">
              {nonTrashBookmarks.length}
            </span>
          </button>
        </div>
      </div>

      {/* 3. Scrollable Content */}
      <main className="popup-body custom-scrollbar">
        {activeTab === 'save' ? (
          <div className="popup-panel">
            {/* Page Preview / Manual URL Card */}
            {isManualUrl ? (
              <div className="popup-card space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="popup-field-label !mb-0">
                    <Globe size={12} /> {t('url')}
                  </span>
                  <button
                    type="button"
                    disabled={!hydrated || isSaving || saved}
                    onClick={() => setPinned((p) => !p)}
                    title={pinned ? t('unpinBookmark') : t('pinBookmark')}
                    aria-label={pinned ? t('unpinBookmark') : t('pinBookmark')}
                    aria-pressed={pinned}
                    className={`popup-icon-btn !w-6 !h-6 ${
                      pinned ? 'text-[var(--accent)] bg-[rgba(59,130,246,0.14)]' : ''
                    }`}
                  >
                    <Pin size={13} className={pinned ? 'fill-current' : ''} />
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('popupEnterUrl')}
                  disabled={!hydrated || isSaving || saved}
                  className="ui-input w-full"
                />
              </div>
            ) : (
              <div className="popup-preview-card">
                <div className="popup-favicon-box">
                  <img
                    src={favicon || getFaviconFallback(url)}
                    alt=""
                    className="w-5 h-5"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = getFaviconFallback(url);
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-[var(--text)] truncate leading-tight">
                    {url ? getDomain(url) : '—'}
                  </p>
                  <p
                    className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 leading-tight"
                    title={url}
                  >
                    {url || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!hydrated || isSaving || saved}
                  onClick={() => setPinned((p) => !p)}
                  title={pinned ? t('unpinBookmark') : t('pinBookmark')}
                  aria-label={pinned ? t('unpinBookmark') : t('pinBookmark')}
                  aria-pressed={pinned}
                  className={`popup-icon-btn shrink-0 border ${
                    pinned
                      ? 'border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] bg-[rgba(59,130,246,0.12)] text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                  }`}
                >
                  <Pin size={13} className={pinned ? 'fill-current' : ''} />
                </button>
              </div>
            )}

            {duplicate && !isEditMode && (
              <div className="ui-notice ui-notice--warn items-center">
                <span className="flex-1 min-w-0">{t('duplicateWarning')}</span>
                <button
                  type="button"
                  className="font-semibold text-[var(--accent)] hover:underline whitespace-nowrap shrink-0"
                  onClick={() => enterEditFromDuplicate(duplicate)}
                >
                  {t('updateExisting')}
                </button>
              </div>
            )}

            {!duplicate && relatedRoots.length > 0 && (
              <div className="ui-notice ui-notice--info flex-col !gap-1.5">
                <p className="flex items-center gap-1.5 font-medium m-0">
                  <CornerDownRight size={13} className="shrink-0 text-[var(--accent)]" />
                  <span>{t('relatedBookmarkExists')}</span>
                </p>
                <ul className="w-full space-y-1 m-0 p-0 list-none">
                  {relatedRoots.map((root) => (
                    <li key={root.id} className="flex items-center gap-1.5 min-w-0">
                      <img
                        src={root.favicon || getFavicon(root.url)}
                        alt=""
                        className="w-3.5 h-3.5 rounded-sm shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = getFaviconFallback(root.url);
                        }}
                      />
                      <span className="truncate flex-1" title={root.url}>
                        {root.title || getDomain(root.url)}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--accent)] hover:underline shrink-0"
                        onClick={() => enterEditFromDuplicate(root)}
                      >
                        {t('editRelated')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Main Form Card */}
            <div className="popup-card space-y-3">
              <label className="block">
                <span className="popup-field-label">{t('title')}</span>
                <input
                  ref={titleInputRef}
                  type="text"
                  name="bookmark-title"
                  autoComplete="off"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('titlePlaceholder')}
                  disabled={!hydrated || isSaving || saved}
                  className="ui-input w-full"
                />
              </label>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="popup-field-label !mb-0">
                    <Folder size={12} /> {t('collection')}
                  </span>
                  {onQuickAddCollection && !isCreatingCollection && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingCollection(true)}
                      disabled={!hydrated || isSaving || saved}
                      className="text-[11.5px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-0.5 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Plus size={12} /> {t('newCollection')}
                    </button>
                  )}
                </div>

                {isCreatingCollection && onQuickAddCollection ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCreateCollection();
                        }
                        if (e.key === 'Escape') {
                          setIsCreatingCollection(false);
                          setNewCollectionName('');
                        }
                      }}
                      placeholder={t('newCollectionPlaceholder')}
                      disabled={creatingCollection}
                      className="ui-input flex-1 min-w-0"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      iconOnly
                      onClick={() => void handleCreateCollection()}
                      disabled={creatingCollection || !newCollectionName.trim()}
                      aria-label={t('save')}
                    >
                      <Check size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => {
                        setIsCreatingCollection(false);
                        setNewCollectionName('');
                      }}
                      disabled={creatingCollection}
                      aria-label={t('cancel')}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ) : (
                  <Dropdown
                    size="sm"
                    value={collectionId}
                    onChange={setCollectionId}
                    options={collectionOptions}
                    ariaLabel={t('collection')}
                    className="w-full"
                    disabled={!hydrated || isSaving || saved}
                    footerAction={
                      onQuickAddCollection
                        ? {
                            label: t('newCollection'),
                            leading: <Plus size={14} />,
                            onClick: () => setIsCreatingCollection(true),
                          }
                        : undefined
                    }
                  />
                )}
              </div>

              <label className="block">
                <span className="popup-field-label">
                  <Hash size={12} /> {t('tags')}
                </span>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
                        className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[11px] font-medium text-[var(--text)] hover:border-[var(--danger)] hover:text-[var(--danger)] transition-colors"
                      >
                        #{tag}
                        <X size={11} className="opacity-70" />
                      </button>
                    ))}
                  </div>
                )}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onFocus={() => setTagInputFocused(true)}
                  onBlur={() => setTagInputFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  placeholder={t('addTags')}
                  className="ui-input w-full"
                />
                {tagSuggestions.length > 0 && (tagInputFocused || tagInput) && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {tagSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addTag(s)}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(59,130,246,0.12)] text-[var(--accent)] hover:bg-[rgba(59,130,246,0.2)] font-medium transition-colors"
                      >
                        #{s}
                      </button>
                    ))}
                  </div>
                )}
              </label>

              <label className="block">
                <span className="popup-field-label">
                  <StickyNote size={12} /> {t('note')}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="ui-textarea w-full min-h-[54px] resize-none"
                  placeholder={t('notePlaceholder')}
                />
              </label>
            </div>

            {error && (
              <div className="ui-notice ui-notice--danger" role="alert">
                {error}
              </div>
            )}
          </div>
        ) : (
          /* === TAB 2: QUICK BROWSE (Collections + Recent Bookmarks) === */
          <div className="popup-panel">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              />
              <input
                type="text"
                value={browseQuery}
                onChange={(e) => setBrowseQuery(e.target.value)}
                placeholder={t('popupSearchPlaceholder')}
                aria-label={t('popupSearchPlaceholder')}
                className="ui-input w-full !pl-7 !pr-7 !h-[30px] !text-[12.5px]"
              />
              {browseQuery && (
                <button
                  type="button"
                  onClick={() => setBrowseQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 popup-icon-btn !w-5 !h-5"
                  aria-label={t('clearSearch')}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {filteredBrowseCollections.length > 0 && (
              <div className="space-y-0.5">
                <div className="popup-field-label px-1.5">{t('collections')}</div>
                {filteredBrowseCollections.slice(0, 8).map((col) => {
                  const Icon = getCollectionIcon(col.icon);
                  const count = collectionCounts.get(col.id) || 0;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      className="popup-row-item"
                      style={{ paddingLeft: 8 + Math.min(col.depth, 3) * 14 }}
                      onClick={() => onOpenLibrary(col.id)}
                    >
                      <Icon
                        size={15}
                        className={`shrink-0 ${getCollectionColorText(col.color, false)}`}
                      />
                      <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium">
                        {col.name}
                      </span>
                      <span className="popup-tab-pill popup-tab-pill--muted">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-0.5">
              <div className="popup-field-label px-1.5">{t('popupRecent')}</div>
              {filteredBrowseBookmarks.length === 0 ? (
                <div className="popup-card text-center py-6 text-[12px] text-[var(--text-muted)]">
                  {browseQuery.trim() ? t('noResults') : t('noBookmarks')}
                </div>
              ) : (
                filteredBrowseBookmarks.map((bm) => (
                  <button
                    key={bm.id}
                    type="button"
                    className="popup-row-item group"
                    onClick={() => {
                      if (chrome?.tabs?.create) {
                        void chrome.tabs.create({ url: bm.url });
                        window.close();
                      } else {
                        window.open(bm.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    title={bm.url}
                  >
                    <img
                      src={bm.favicon || getFavicon(bm.url)}
                      alt=""
                      className="w-4 h-4 rounded-sm shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = getFaviconFallback(bm.url);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium truncate leading-tight">
                        {bm.title || getDomain(bm.url)}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate leading-tight">
                        {getDomain(bm.url)}
                      </div>
                    </div>
                    <ExternalLink
                      size={12}
                      className="shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* 4. Clean 1-row Footer (strictly white-space: nowrap) */}
      {activeTab === 'save' ? (
        <footer className="popup-footer">
          {isEditMode && onRemove && (
            <Button
              variant="danger-subtle"
              iconOnly
              disabled={isSaving || saved}
              onClick={() => void handleRemove()}
              title={t('moveToTrash')}
              aria-label={t('moveToTrash')}
            >
              <Trash2 size={15} />
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenLibrary()}>
            <FolderOpen size={14} />
            <span>{t('libraryShort')}</span>
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={isSaving || !normalizedPreviewUrl || saved || !hydrated}
            onClick={handleSave}
          >
            {saved ? (
              <>
                <Check size={15} />
                <span>{isEditMode ? t('bookmarkUpdated') : t('saved')}</span>
              </>
            ) : (
              <span>{isEditMode || duplicate ? t('update') : t('save')}</span>
            )}
          </Button>
        </footer>
      ) : (
        <footer className="popup-footer popup-footer--grid">
          <Button variant="secondary" onClick={() => onOpenLibrary()}>
            <FolderOpen size={14} />
            <span>{t('libraryShort')}</span>
          </Button>
          <Button variant="secondary" onClick={onOpenDashboard}>
            <LayoutGrid size={14} />
            <span>{t('manageLabel')}</span>
          </Button>
        </footer>
      )}
    </div>
  );
}
