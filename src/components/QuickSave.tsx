import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  CloudOff,
  CornerDownRight,
  Folder,
  Hash,
  Maximize2,
  Pin,
  Plus,
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
  getDomain,
  getFavicon,
  getFaviconFallback,
  getCollectionTags,
  normalizeUrlInput,
} from '../utils';
import { createT } from '../i18n';
import { Dropdown } from './Dropdown';
import type { GDriveUiStatus } from '../driveSync';

interface QuickSaveProps {
  bookmarks: Bookmark[];
  collections: Collection[];
  settings: AppSettings;
  allTags: string[];
  onSave: (
    data: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
  onOpenLibrary: () => void;
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
  const [url, setUrl] = useState('');
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
        setHydrated(true);
        return;
      }

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

  const collectionOptions = useMemo(() => {
    const tree = flattenCollectionTree(buildCollectionTree(collections));
    return [
      { value: COLLECTION.UNSORTED, label: t('unsorted') },
      ...tree.map((c) => ({
        value: c.id,
        label: `${'—'.repeat(c.depth)} ${c.name}`.trim(),
      })),
    ];
  }, [collections, t]);

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

  const isEditMode = !!editingId;

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

  return (
    <div
      className="w-[384px] min-h-[430px] max-h-[580px] flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isSaving && url && hydrated && !saved) {
          e.preventDefault();
          void handleSave();
        }
      }}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={chrome.runtime.getURL('public/icons/icon-48.png')}
            alt=""
            className="w-6 h-6 rounded-md shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-[13.5px] font-bold tracking-tight truncate">
              {isEditMode ? t('editBookmark') : t('quickSave')}
            </h1>
            {isEditMode && (
              <p className="text-[11px] text-brand-600 dark:text-brand-400 font-medium leading-none mt-0.5">
                {t('alreadySaved')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {(onOpenGDrive || onSyncGDrive) && (
            <button
              type="button"
              onClick={() => {
                if (gdrive?.connected && onSyncGDrive) onSyncGDrive();
                else if (onOpenGDrive) onOpenGDrive();
                else onSyncGDrive?.();
              }}
              className={`btn-icon-sm dark:hover:bg-zinc-800 relative ${
                gdrive?.connected
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
              }`}
              title={
                gdrive?.needsReauth
                  ? t('gdriveStatusNeedsReauth')
                  : gdrive?.connected
                  ? `${t('gdriveMenuSync')}${gdrive.email ? ` · ${gdrive.email}` : ''}`
                  : t('gdriveMenuTitle')
              }
              aria-label={t('gdriveMenuTitle')}
            >
              {gdrive?.connected ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
              {(!gdrive?.connected || gdrive?.needsReauth) && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenDashboard}
            className="btn-icon-sm dark:hover:bg-zinc-800"
            title={t('openDashboard')}
            aria-label={t('openDashboard')}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="px-2 h-7 text-[12px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            {t('openLibrary')}
          </button>
        </div>
      </header>
      <div className="accent-line shrink-0" />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-3">
        {/* Page preview + Pin quick toggle */}
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/80">
          <img
            src={favicon || getFaviconFallback(url)}
            alt=""
            className="w-8 h-8 rounded-lg bg-white dark:bg-zinc-700 p-1 border border-zinc-200/60 dark:border-zinc-600 shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).src = getFaviconFallback(url);
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">
              {url ? getDomain(url) : '—'}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5" title={url}>
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
            className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
              pinned
                ? 'bg-brand-50 border-brand-200 text-brand-600 dark:bg-brand-950/60 dark:border-brand-800 dark:text-brand-400'
                : 'bg-white border-zinc-200 text-zinc-400 hover:text-zinc-700 dark:bg-zinc-800 dark:border-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${pinned ? 'fill-current' : ''}`} />
          </button>
        </div>

        {duplicate && !isEditMode && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[12px] text-amber-800 dark:text-amber-200">
            <span className="flex-1">{t('duplicateWarning')}</span>
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => enterEditFromDuplicate(duplicate)}
            >
              {t('updateExisting')}
            </button>
          </div>
        )}

        {!duplicate && relatedRoots.length > 0 && (
          <div className="px-3 py-2 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-[12px] text-sky-800 dark:text-sky-200">
            <p className="flex items-center gap-1.5 font-medium">
              <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
              {t('relatedBookmarkExists')}
            </p>
            <ul className="mt-1.5 space-y-1">
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
                  <span className="truncate" title={root.url}>
                    {root.title || getDomain(root.url)}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-[11px] font-semibold underline shrink-0"
                    onClick={() => enterEditFromDuplicate(root)}
                  >
                    {t('editRelated')}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-sky-600 dark:text-sky-400">
              {t('saveSeparately')}
            </p>
          </div>
        )}

        <label className="block space-y-1">
          <span className="section-label">{t('title')}</span>
          <input
            ref={titleInputRef}
            type="text"
            name="bookmark-title"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
            disabled={!hydrated || isSaving || saved}
            className="brand-input-sm w-full dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
          />
        </label>

        <div className="block space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="section-label flex items-center gap-1">
              <Folder className="w-3 h-3" /> {t('collection')}
            </span>
            {onQuickAddCollection && !isCreatingCollection && (
              <button
                type="button"
                onClick={() => setIsCreatingCollection(true)}
                disabled={!hydrated || isSaving || saved}
                className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 inline-flex items-center gap-0.5 disabled:opacity-50"
              >
                <Plus className="w-3 h-3" /> {t('newCollection')}
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
                className="brand-input-sm flex-1 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => void handleCreateCollection()}
                disabled={creatingCollection || !newCollectionName.trim()}
                className="btn-icon-sm dark:hover:bg-zinc-800 text-brand-600 disabled:opacity-50"
                aria-label={t('save')}
              >
                {creatingCollection ? (
                  <span className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingCollection(false);
                  setNewCollectionName('');
                }}
                disabled={creatingCollection}
                className="btn-icon-sm dark:hover:bg-zinc-800"
                aria-label={t('cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Dropdown
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
                      leading: <Plus className="w-3.5 h-3.5" />,
                      onClick: () => setIsCreatingCollection(true),
                    }
                  : undefined
              }
            />
          )}
        </div>

        <label className="block space-y-1">
          <span className="section-label flex items-center gap-1">
            <Hash className="w-3 h-3" /> {t('tags')}
          </span>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
                  className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300 transition-colors"
                >
                  #{tag}
                  <X className="w-3 h-3 opacity-60" />
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
            className="brand-input-sm w-full dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
          />
          {tagSuggestions.length > 0 && (tagInputFocused || tagInput) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tagSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(s)}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 hover:bg-brand-100 dark:bg-brand-950 dark:hover:bg-brand-900/60 text-brand-700 dark:text-brand-300 transition-colors"
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
        </label>

        <label className="block space-y-1">
          <span className="section-label flex items-center gap-1">
            <StickyNote className="w-3 h-3" /> {t('note')}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full brand-input-sm min-h-[56px] py-2 resize-none dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
            placeholder={t('notePlaceholder')}
          />
        </label>

        {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <footer className="px-4 py-3 border-t border-zinc-200/80 dark:border-zinc-800 flex items-center gap-1.5 bg-zinc-50/50 dark:bg-zinc-900">
        {onOpenPreferences && (
          <button
            type="button"
            onClick={onOpenPreferences}
            className="btn-icon-sm dark:hover:bg-zinc-800"
            title={t('settings')}
            aria-label={t('settings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {isEditMode && onRemove && (
          <button
            type="button"
            disabled={isSaving || saved}
            onClick={() => void handleRemove()}
            className="btn-icon-sm text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/40"
            title={t('moveToTrash')}
            aria-label={t('moveToTrash')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          disabled={isSaving || !url || saved || !hydrated}
          onClick={handleSave}
          className="btn-brand-sm flex-1"
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" /> {isEditMode ? t('bookmarkUpdated') : t('saved')}
            </>
          ) : isEditMode || duplicate ? (
            t('update')
          ) : (
            t('save')
          )}
        </button>
      </footer>
    </div>
  );
}
