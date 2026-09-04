import { useEffect, useState, useRef, useMemo } from 'react';
import { X, Globe, AlignLeft, Hash, Folder, Plus, Check, StickyNote } from 'lucide-react';
import type { Bookmark, Collection } from '../types';
import { COLLECTION } from '../types';
import { buildCollectionTree, flattenCollectionTree, normalizeUrlInput, getFavicon, getFaviconFallback, findBookmarkByUrl, getCollectionTags } from '../utils';
import { useEscapeKey, useFocusTrap } from '../hooks';
import { t } from '../i18n';
import { Dropdown } from './Dropdown';

interface AddBookmarkModalProps {
  initial?: Partial<Bookmark>;
  existingBookmarks: Bookmark[];
  collections: Collection[];
  allTags: string[];
  onSave: (data: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Promise<void>;
  onQuickAddCollection: (name: string) => Promise<string | void>;
  onClose: () => void;
}

export function AddBookmarkModal({
  initial,
  existingBookmarks,
  collections,
  allTags,
  onSave,
  onQuickAddCollection,
  onClose,
}: AddBookmarkModalProps) {
  const [url, setUrl] = useState(initial?.url || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [note, setNote] = useState(initial?.note || '');
  const [collectionId, setCollectionId] = useState(initial?.collectionId || COLLECTION.UNSORTED);
  const [editingId, setEditingId] = useState<string | undefined>(initial?.id);

  // Tags
  const [tags, setTags] = useState<string[]>(initial?.tags || []);
  const [tagInputValue, setTagInputValue] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  // Quick Collection
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagInputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  const didHydrateRef = useRef(false);
  useEscapeKey(onClose);

  // Auto-grow note textarea up to 200px
  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [note]);

  useEffect(() => {
    // Hydrate from the active tab exactly once, and never after the user starts typing —
    // otherwise a background/gdrive refresh that changes `existingBookmarks` re-runs this
    // effect and wipes what the user entered.
    if (didHydrateRef.current) return;
    if (initial?.url || initial?.title) {
      didHydrateRef.current = true;
      return;
    }
    let ignore = false;
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (ignore || didHydrateRef.current) return;
      didHydrateRef.current = true;
      const tab = tabs[0];
      if (tab?.url && !tab.url.startsWith('chrome://')) {
        const existing = findBookmarkByUrl(existingBookmarks, tab.url);
        if (existing) {
          setUrl(existing.url);
          setTitle(existing.title);
          setNote(existing.note || '');
          setCollectionId(existing.collectionId);
          setTags(existing.tags);
          setEditingId(existing.id);
        } else {
          setUrl(tab.url);
          setTitle(tab.title || '');
        }
      }
    });
    return () => {
      ignore = true;
    };
  }, [initial, existingBookmarks]);



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUrlInput(url);
    if (!normalized) return;
    setError(null);
    setIsSaving(true);

    // Check if the user manually typed an existing URL — match canonically (ignoring
    // www / trailing slash / hash) to stay consistent with the backend's merge, which
    // would otherwise silently overwrite a "different" URL that's really the same page.
    let finalEditingId = editingId;
    if (!finalEditingId) {
       const manuallyTypedExisting = findBookmarkByUrl(existingBookmarks, normalized);
       if (manuallyTypedExisting) {
         finalEditingId = manuallyTypedExisting.id;
       }
    }

    try {
      await onSave({
        ...(finalEditingId ? { id: finalEditingId } : {}),
        url: normalized,
        title,
        note,
        favicon: '',
        collectionId,
        tags,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save bookmark');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = (t: string) => {
    const trimmed = t.trim().toLowerCase().replace(/^#/, '');
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInputValue('');
    setShowTagSuggestions(false);
  };

  const removeTag = (tToRemove: string) => {
    setTags(tags.filter((t) => t !== tToRemove));
  };

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) {
      setIsCreatingCollection(false);
      return;
    }
    const id = await onQuickAddCollection(name);
    if (typeof id === 'string' && id) setCollectionId(id);
    setIsCreatingCollection(false);
    setNewCollectionName('');
  };

  const filteredTags = allTags
    .filter((t) => !tags.includes(t))
    .filter((t) => t.includes(tagInputValue.toLowerCase().trim()));

  // Tags used by bookmarks already in the selected collection (incl. sub-collections),
  // ranked by frequency. These get suggested first when the user focuses the tag input.
  const collectionSuggestedTags = useMemo(
    () => getCollectionTags(existingBookmarks, collections, collectionId),
    [existingBookmarks, collections, collectionId]
  );
  const visibleCollectionTags = collectionSuggestedTags
    .filter((t) => !tags.includes(t))
    .filter((t) => t.includes(tagInputValue.toLowerCase().trim()));

  const collectionOptions = useMemo(
    () => flattenCollectionTree(buildCollectionTree(collections)),
    [collections]
  );

  const previewUrl = useMemo(() => {
    const candidate = normalizeUrlInput(url);
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      return {
        favicon: getFavicon(candidate),
        host: parsed.hostname.replace(/^www\./, ''),
      };
    } catch {
      return null;
    }
  }, [url]);

  const duplicate = useMemo(() => {
    const candidate = normalizeUrlInput(url);
    if (!candidate) return null;
    const match = findBookmarkByUrl(existingBookmarks, candidate);
    return match && match.id !== editingId ? match : null;
  }, [url, existingBookmarks, editingId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-bookmark-title"
    >
      <div
        ref={containerRef}
        className="relative w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-xl overflow-hidden animate-slide-up flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h2 id="add-bookmark-title" className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight">
            {editingId ? t('editBookmark') : t('addBookmark')}
          </h2>
          <button
            onClick={onClose}
            className="btn-icon-sm"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar p-5 flex-1 pl-5 pr-5">
          <form id="add-bookmark-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}
            {duplicate && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[12px] font-medium text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
                <span>{t('duplicateWarning')}</span>
                <button
                  type="button"
                  className="underline font-semibold shrink-0"
                  onClick={() => {
                    setEditingId(duplicate.id);
                    setTitle(duplicate.title);
                    setNote(duplicate.note || '');
                    setTags(duplicate.tags);
                    setCollectionId(duplicate.collectionId);
                  }}
                >
                  {t('updateExisting')}
                </button>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-zinc-400" /> {t('url')}
              </label>
              <div className="relative">
                <input
                  autoFocus
                  required
                  // text (not url) so a bare domain like "example.com" isn't blocked by native
                  // URL validation before normalizeUrlInput can prepend https:// on submit.
                  type="text"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={(e) => {
                    const normalized = normalizeUrlInput(e.target.value);
                    if (normalized !== e.target.value) setUrl(normalized);
                  }}
                  className={`brand-input w-full ${previewUrl ? 'pl-9' : ''}`}
                  placeholder="https://..."
                />
                {previewUrl && (
                  <div
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 flex items-center justify-center overflow-hidden shadow-sm"
                    title={previewUrl.host}
                  >
                    <img
                      src={previewUrl.favicon}
                      alt=""
                      className="w-3.5 h-3.5"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = getFaviconFallback(url);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <AlignLeft className="w-3.5 h-3.5 text-zinc-400" /> {t('title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="brand-input w-full"
                placeholder={t('titlePlaceholder')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5 text-zinc-400" /> {t('note')} <span className="text-zinc-400 font-normal">({t('optional')})</span>
              </label>
              <textarea
                ref={noteRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="brand-input w-full min-h-[60px] max-h-[200px] py-2.5 leading-relaxed resize-none custom-scrollbar overflow-auto"
                placeholder={t('notePlaceholder')}
              />
            </div>

            <div className="flex flex-col gap-1.5 relative">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-zinc-400" /> {t('collection')}
                </label>
                {!isCreatingCollection && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingCollection(true)}
                    className="text-[11px] text-brand-600 hover:text-brand-500 flex items-center gap-1 font-medium"
                  >
                    <Plus className="w-3 h-3" /> {t('newLabel')}
                  </button>
                )}
              </div>
              
              {isCreatingCollection ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateCollection();
                      }
                      if (e.key === 'Escape') {
                        // Cancel inline creation only — don't let Escape bubble up and close
                        // the whole modal.
                        e.preventDefault();
                        e.stopPropagation();
                        setIsCreatingCollection(false);
                      }
                    }}
                    placeholder={t('newCollectionPlaceholder')}
                    className="brand-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleCreateCollection}
                    className="h-9 px-3 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:border-zinc-600 dark:text-zinc-200 rounded-md transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingCollection(false)}
                    className="h-9 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent text-zinc-500 dark:text-zinc-400 rounded-md transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Dropdown
                  value={collectionId}
                  onChange={setCollectionId}
                  ariaLabel="Collection"
                  options={[
                    { value: COLLECTION.UNSORTED, label: t('unsorted') },
                    ...collectionOptions.map((c) => ({
                      value: c.id,
                      label: c.name,
                      depth: c.depth,
                    })),
                  ]}
                  footerAction={{
                    label: t('newCollection'),
                    leading: <Plus className="w-3.5 h-3.5" />,
                    onClick: () => setIsCreatingCollection(true),
                  }}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5 relative">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-zinc-400" /> {t('tags')}
              </label>
              
              <div
                className="min-h-[36px] p-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md flex flex-wrap gap-1.5 focus-within:bg-white dark:focus-within:bg-zinc-900 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/30 transition-shadow cursor-text"
                onClick={() => tagInputRef.current?.focus()}
              >
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 text-[12px] rounded font-medium shadow-sm"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTag(t);
                      }}
                      className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInputValue}
                  onChange={(e) => {
                    setTagInputValue(e.target.value);
                    setShowTagSuggestions(true);
                  }}
                  onFocus={() => setShowTagSuggestions(true)}
                  onBlur={() => {
                    setTimeout(() => setShowTagSuggestions(false), 150);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      if (tagInputValue) {
                        handleAddTag(tagInputValue);
                      }
                    } else if (e.key === 'Backspace' && !tagInputValue && tags.length > 0) {
                      setTags(tags.slice(0, -1));
                    }
                  }}
                  className="flex-1 min-w-[60px] bg-transparent text-[13px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none h-6 px-1"
                  placeholder={tags.length === 0 ? t('addTags') : ''}
                />
              </div>

              {/* Tag Suggestions Dropdown */}
              {showTagSuggestions &&
                (tagInputValue || visibleCollectionTags.length > 0 || filteredTags.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg z-10 custom-scrollbar">
                  {tagInputValue && !allTags.includes(tagInputValue.toLowerCase().trim()) && !tags.includes(tagInputValue.toLowerCase().trim()) && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAddTag(tagInputValue);
                      }}
                      className="w-full text-left px-3 py-2 text-[12px] text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/50 flex items-center gap-2 font-medium"
                    >
                      <Plus className="w-3 h-3" /> {t('create')} "{tagInputValue.trim()}"
                    </button>
                  )}
                  {visibleCollectionTags.length > 0 && (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      {t('suggestedTags')}
                    </div>
                  )}
                  {visibleCollectionTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAddTag(t);
                      }}
                      className="w-full text-left px-3 py-2 text-[12px] text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/50"
                    >
                      # {t}
                    </button>
                  ))}
                  {filteredTags
                    .filter((t) => !visibleCollectionTags.includes(t))
                    .map((t) => (
                      <button
                        key={t}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleAddTag(t);
                        }}
                        className="w-full text-left px-3 py-2 text-[12px] text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-zinc-50"
                      >
                        # {t}
                      </button>
                    ))}
                  {filteredTags.length === 0 && !tagInputValue && visibleCollectionTags.length === 0 && (
                    <div className="px-3 py-2 text-[12px] text-zinc-400 dark:text-zinc-500 italic">{t('noExistingTags')}</div>
                  )}
                </div>
              )}
            </div>
          </form>
        </div>

        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-2 shrink-0 bg-zinc-50/50 dark:bg-zinc-800/40">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost-sm px-4"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            form="add-bookmark-form"
            disabled={isSaving || !url}
            className="btn-brand-sm px-4"
          >
            {isSaving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
