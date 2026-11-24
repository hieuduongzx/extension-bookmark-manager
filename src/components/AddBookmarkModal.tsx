import { useEffect, useState, useRef, useMemo } from 'react';
import {
  X,
  Globe,
  AlignLeft,
  Hash,
  Folder,
  Plus,
  Check,
  StickyNote,
  CornerDownRight,
  Pin,
  Image as ImageIcon,
} from 'lucide-react';
import type { Bookmark, Collection, LocaleCode } from '../types';
import { COLLECTION } from '../types';
import {
  buildCollectionTree,
  flattenCollectionTree,
  normalizeUrlInput,
  getFavicon,
  getFaviconFallback,
  findBookmarkByUrl,
  findRelatedRootBookmarks,
  getCollectionTags,
} from '../utils';
import { createT } from '../i18n';
import { Dropdown } from './Dropdown';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface AddBookmarkModalProps {
  initial?: Partial<Bookmark>;
  existingBookmarks: Bookmark[];
  collections: Collection[];
  allTags: string[];
  onSave: (
    data: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onQuickAddCollection: (name: string) => Promise<string | void>;
  onClose: () => void;
  locale?: LocaleCode;
}

export function AddBookmarkModal({
  initial,
  existingBookmarks,
  collections,
  allTags,
  onSave,
  onQuickAddCollection,
  onClose,
  locale = 'en',
}: AddBookmarkModalProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [url, setUrl] = useState(initial?.url || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [note, setNote] = useState(initial?.note || '');
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl || '');
  const [pinned, setPinned] = useState(Boolean(initial?.pinned));
  const [collectionId, setCollectionId] = useState(initial?.collectionId || COLLECTION.UNSORTED);
  const [editingId, setEditingId] = useState<string | undefined>(initial?.id);

  const [tags, setTags] = useState<string[]>(initial?.tags || []);
  const [tagInputValue, setTagInputValue] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagInputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const didHydrateRef = useRef(false);

  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [note]);

  useEffect(() => {
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
      if (
        tab?.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://')
      ) {
        const existing = findBookmarkByUrl(existingBookmarks, tab.url);
        if (existing) {
          setUrl(existing.url);
          setTitle(existing.title);
          setNote(existing.note || '');
          setCoverUrl(existing.coverUrl || '');
          setPinned(Boolean(existing.pinned));
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

  const submitForm = async () => {
    const normalized = normalizeUrlInput(url);
    if (!normalized) return;
    setError(null);
    setIsSaving(true);

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
        pinned,
        coverUrl: coverUrl.trim() ? normalizeUrlInput(coverUrl) : undefined,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitForm();
  };

  const handleAddTag = (tagStr: string) => {
    const trimmed = tagStr.trim().toLowerCase().replace(/^#/, '');
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInputValue('');
    setShowTagSuggestions(false);
  };

  const removeTag = (tToRemove: string) => {
    setTags(tags.filter((x) => x !== tToRemove));
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
    .filter((tag) => !tags.includes(tag))
    .filter((tag) => tag.includes(tagInputValue.toLowerCase().trim()));

  const collectionSuggestedTags = useMemo(
    () => getCollectionTags(existingBookmarks, collections, collectionId),
    [existingBookmarks, collections, collectionId]
  );
  const visibleCollectionTags = collectionSuggestedTags
    .filter((tag) => !tags.includes(tag))
    .filter((tag) => tag.includes(tagInputValue.toLowerCase().trim()));

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

  const relatedRoots = useMemo(() => {
    if (duplicate) return [];
    const candidate = normalizeUrlInput(url);
    if (!candidate) return [];
    return findRelatedRootBookmarks(existingBookmarks, candidate, editingId).slice(0, 3);
  }, [url, existingBookmarks, editingId, duplicate]);

  return (
    <Dialog
      open={true}
      title={editingId ? t('editBookmark') : t('addBookmark')}
      onClose={onClose}
      closeLabel={t('close')}
      maxWidth={460}
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={() => setPinned((p) => !p)}
          title={pinned ? t('unpinBookmark') : t('pinBookmark')}
          aria-label={pinned ? t('unpinBookmark') : t('pinBookmark')}
          aria-pressed={pinned}
          className={pinned ? '!text-[var(--accent)] !bg-[rgba(59,130,246,0.14)]' : ''}
        >
          <Pin size={15} className={pinned ? 'fill-current' : ''} />
        </Button>
      }
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-[11px] text-[var(--text-muted)] hidden sm:inline">Ctrl/⌘+Enter</span>
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="add-bookmark-form"
              variant="primary"
              size="sm"
              disabled={isSaving || !url}
            >
              {isSaving ? t('saving') : editingId ? t('update') : t('save')}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="add-bookmark-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-3.5"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isSaving && url) {
            e.preventDefault();
            void submitForm();
          }
        }}
      >
        {error && <div className="ui-notice ui-notice--danger">{error}</div>}

        {duplicate && (
          <div className="ui-notice ui-notice--warn items-center justify-between">
            <span>{t('duplicateWarning')}</span>
            <button
              type="button"
              className="font-semibold text-[var(--accent)] hover:underline shrink-0"
              onClick={() => {
                setEditingId(duplicate.id);
                setTitle(duplicate.title);
                setNote(duplicate.note || '');
                setCoverUrl(duplicate.coverUrl || '');
                setPinned(Boolean(duplicate.pinned));
                setTags(duplicate.tags);
                setCollectionId(duplicate.collectionId);
              }}
            >
              {t('updateExisting')}
            </button>
          </div>
        )}

        {!duplicate && relatedRoots.length > 0 && (
          <div className="ui-notice ui-notice--info flex-col !gap-1.5">
            <p className="flex items-center gap-1.5 font-medium m-0">
              <CornerDownRight size={14} className="shrink-0 text-[var(--accent)]" />
              {t('relatedBookmarkExists')}
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
                  <span className="truncate" title={root.url}>
                    {root.title || root.url}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-[var(--text-muted)] m-0">{t('saveSeparately')}</p>
          </div>
        )}

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <Globe size={13} /> {t('url')}
          </label>
          <div className="relative">
            <input
              autoFocus
              required
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={(e) => {
                const normalized = normalizeUrlInput(e.target.value);
                if (normalized !== e.target.value) setUrl(normalized);
              }}
              className={`ui-input w-full ${previewUrl ? '!pl-9' : ''}`}
              placeholder="https://..."
            />
            {previewUrl && (
              <div
                className="absolute left-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center overflow-hidden"
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

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <AlignLeft size={13} /> {t('title')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="ui-input w-full"
            placeholder={t('titlePlaceholder')}
          />
        </div>

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <StickyNote size={13} /> {t('note')}{' '}
            <span className="font-normal opacity-75">({t('optional')})</span>
          </label>
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="ui-textarea w-full min-h-[60px] max-h-[180px] leading-relaxed resize-none custom-scrollbar overflow-auto"
            placeholder={t('notePlaceholder')}
          />
        </div>

        <div className="relative">
          <div className="flex items-center justify-between mb-1">
            <label className="ui-label !mb-0 flex items-center gap-1.5">
              <Folder size={13} /> {t('collection')}
            </label>
            {!isCreatingCollection && (
              <button
                type="button"
                onClick={() => setIsCreatingCollection(true)}
                className="text-[11.5px] text-[var(--accent)] hover:underline flex items-center gap-0.5 font-medium"
              >
                <Plus size={12} /> {t('newLabel')}
              </button>
            )}
          </div>

          {isCreatingCollection ? (
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
                    e.preventDefault();
                    e.stopPropagation();
                    setIsCreatingCollection(false);
                  }
                }}
                placeholder={t('newCollectionPlaceholder')}
                className="ui-input flex-1"
              />
              <Button variant="primary" size="sm" iconOnly onClick={() => void handleCreateCollection()}>
                <Check size={14} />
              </Button>
              <Button variant="ghost" size="sm" iconOnly onClick={() => setIsCreatingCollection(false)}>
                <X size={14} />
              </Button>
            </div>
          ) : (
            <Dropdown
              size="sm"
              value={collectionId}
              onChange={setCollectionId}
              ariaLabel={t('collection')}
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
                leading: <Plus size={14} />,
                onClick: () => setIsCreatingCollection(true),
              }}
            />
          )}
        </div>

        <div className="relative">
          <label className="ui-label flex items-center gap-1.5">
            <Hash size={13} /> {t('tags')}
          </label>

          <div
            className="min-h-[34px] p-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] flex flex-wrap gap-1.5 focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[rgba(59,130,246,0.22)] transition-all cursor-text"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 px-2 py-0.5 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] text-[12px] rounded-[6px] font-medium"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTag(tag);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                >
                  <X size={12} />
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
                  if (tagInputValue) handleAddTag(tagInputValue);
                } else if (e.key === 'Backspace' && !tagInputValue && tags.length > 0) {
                  setTags(tags.slice(0, -1));
                }
              }}
              className="flex-1 min-w-[60px] bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none h-5 px-1"
              placeholder={tags.length === 0 ? t('addTags') : ''}
            />
          </div>

          {showTagSuggestions &&
            (tagInputValue || visibleCollectionTags.length > 0 || filteredTags.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-pop z-10 custom-scrollbar p-1">
                {tagInputValue &&
                  !allTags.includes(tagInputValue.toLowerCase().trim()) &&
                  !tags.includes(tagInputValue.toLowerCase().trim()) && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAddTag(tagInputValue);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--accent)] hover:bg-[rgba(59,130,246,0.12)] rounded-[6px] flex items-center gap-1.5 font-medium"
                    >
                      <Plus size={12} /> {t('create')} &ldquo;{tagInputValue.trim()}&rdquo;
                    </button>
                  )}
                {visibleCollectionTags.length > 0 && (
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {t('suggestedTags')}
                  </div>
                )}
                {visibleCollectionTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAddTag(tag);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--accent)] hover:bg-[rgba(59,130,246,0.12)] rounded-[6px]"
                  >
                    # {tag}
                  </button>
                ))}
                {filteredTags
                  .filter((tag) => !visibleCollectionTags.includes(tag))
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAddTag(tag);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[6px]"
                    >
                      # {tag}
                    </button>
                  ))}
                {filteredTags.length === 0 &&
                  !tagInputValue &&
                  visibleCollectionTags.length === 0 && (
                    <div className="px-2.5 py-2 text-[12px] text-[var(--text-muted)] italic">
                      {t('noExistingTags')}
                    </div>
                  )}
              </div>
            )}
        </div>

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <ImageIcon size={13} /> {t('coverImageUrl')}{' '}
            <span className="font-normal opacity-75">({t('optional')})</span>
          </label>
          <input
            type="text"
            inputMode="url"
            value={coverUrl}
            onChange={(e) => setCoverUrl(e.target.value)}
            className="ui-input w-full"
            placeholder={t('coverImagePlaceholder')}
          />
        </div>
      </form>
    </Dialog>
  );
}
