import { useMemo, useState } from 'react';
import { X, Folder, Image as ImageIcon, Palette, Trash2 } from 'lucide-react';
import type { Collection, CollectionColor, CollectionIcon, LocaleCode } from '../types';
import { buildCollectionTree, flattenCollectionTree, getCollectionDescendants } from '../utils';
import { useEscapeKey, useFocusTrap } from '../hooks';
import { createT } from '../i18n';
import { Dropdown } from './Dropdown';
import {
  COLLECTION_BADGE_BG,
  COLLECTION_COLORS,
  COLLECTION_ICONS,
  getCollectionIcon,
} from '../collectionIcons';

interface CollectionModalProps {
  existing?: Collection;
  collections: Collection[];
  onSave: (data: {
    name: string;
    icon: CollectionIcon;
    color: CollectionColor;
    parentId?: string;
  }) => Promise<void>;
  onDelete?: (id: string) => void;
  onClose: () => void;
  locale?: LocaleCode;
}

export function CollectionModal({
  existing,
  collections,
  onSave,
  onDelete,
  onClose,
  locale = 'en',
}: CollectionModalProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [name, setName] = useState(existing?.name || '');
  const [icon, setIcon] = useState<CollectionIcon>(existing?.icon || 'folder');
  const [color, setColor] = useState<CollectionColor>(existing?.color || 'blue');
  const [parentId, setParentId] = useState<string>(existing?.parentId || '');
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose);

  const descendants = existing
    ? getCollectionDescendants(collections, existing.id)
    : new Set<string>();
  const validParents = flattenCollectionTree(buildCollectionTree(collections)).filter(
    (c) => c.id !== existing?.id && !descendants.has(c.id)
  );

  const PreviewIcon = getCollectionIcon(icon);

  const submitForm = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ name: name.trim(), icon, color, parentId: parentId || undefined });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitForm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/45 dark:bg-black/65 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="collection-modal-title"
    >
      <div
        ref={containerRef}
        className="relative w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-pop rounded-2xl overflow-hidden animate-scale-in flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isSaving && name.trim()) {
            e.preventDefault();
            void submitForm();
          }
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h2
            id="collection-modal-title"
            className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight"
          >
            {existing ? t('editCollection') : t('newCollection')}
          </h2>
          <button type="button" onClick={onClose} className="btn-icon-sm" aria-label={t('close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar p-5 flex-1">
          <form id="collection-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${COLLECTION_BADGE_BG[color]} transition-colors`}
              aria-hidden="true"
            >
              <div className="w-9 h-9 rounded-lg bg-white/80 border border-white/60 dark:bg-zinc-900/60 dark:border-zinc-700 flex items-center justify-center shadow-sm">
                <PreviewIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {name.trim() || t('collectionNameLabel')}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('livePreview')}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-zinc-400" /> {t('name')}
              </label>
              <input
                autoFocus
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="brand-input w-full"
                placeholder={t('collectionNamePlaceholder')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-zinc-400" /> {t('parentCollection')}
              </label>
              <Dropdown
                value={parentId}
                onChange={setParentId}
                ariaLabel={t('parentCollection')}
                placeholder={t('noneTopLevel')}
                options={[
                  { value: '', label: t('noneTopLevel') },
                  ...validParents.map((c) => ({
                    value: c.id,
                    label: c.name,
                    depth: c.depth,
                  })),
                ]}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-zinc-400" /> {t('icon')}
              </label>
              <div className="grid grid-cols-8 gap-1.5">
                {COLLECTION_ICONS.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setIcon(i.id)}
                    className={`flex items-center justify-center h-8 rounded-lg border transition-all ${
                      icon === i.id
                        ? 'bg-brand-50 border-brand-300 text-brand-700 shadow-sm dark:bg-brand-950/60 dark:border-brand-700 dark:text-brand-300'
                        : 'bg-white border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:text-zinc-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-200'
                    }`}
                    title={i.label}
                    aria-label={i.label}
                  >
                    <i.icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-zinc-400" /> {t('color')}
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {COLLECTION_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    className={`w-6 h-6 rounded-full transition-transform outline-none ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ${
                      color === c.id
                        ? 'ring-zinc-900 dark:ring-zinc-100 scale-110'
                        : 'ring-transparent hover:scale-110'
                    } ${c.swatch}`}
                    title={c.id}
                    aria-label={c.id}
                  />
                ))}
              </div>
            </div>
          </form>
        </div>

        <div className="px-5 py-3.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center shrink-0 bg-zinc-50/60 dark:bg-zinc-800/40">
          {existing && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(existing.id)}
              className="mr-auto px-3 h-8 rounded-md text-[12.5px] font-medium text-rose-600 bg-rose-50 border border-rose-200 shadow-sm hover:bg-rose-100 hover:border-rose-300 dark:text-rose-400 dark:bg-rose-950/40 dark:border-rose-900 dark:hover:bg-rose-950/70 dark:hover:border-rose-800 flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('delete')}
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="btn-ghost-sm px-4">
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="collection-form"
              disabled={isSaving || !name.trim()}
              className="btn-brand-sm px-4"
            >
              {isSaving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
