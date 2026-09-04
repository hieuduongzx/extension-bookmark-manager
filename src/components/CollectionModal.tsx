import { useState } from 'react';
import { X, Folder, Image as ImageIcon, Palette, Trash2 } from 'lucide-react';
import type { Collection, CollectionColor, CollectionIcon } from '../types';
import { Globe, ShoppingCart, Film, Music, Code, Briefcase, Heart, Star, Book } from 'lucide-react';

import { buildCollectionTree, flattenCollectionTree, getCollectionDescendants } from '../utils';
import { useEscapeKey, useFocusTrap } from '../hooks';
import { t } from '../i18n';
import { Dropdown } from './Dropdown';

interface CollectionModalProps {
  existing?: Collection;
  collections: Collection[];
  onSave: (data: { name: string; icon: CollectionIcon; color: CollectionColor; parentId?: string }) => Promise<void>;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

const ICONS: { id: CollectionIcon; label: string; icon: React.ElementType }[] = [
  { id: 'folder', label: 'Folder', icon: Folder },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'heart', label: 'Heart', icon: Heart },
  { id: 'briefcase', label: 'Briefcase', icon: Briefcase },
  { id: 'book', label: 'Book', icon: Book },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'film', label: 'Film', icon: Film },
  { id: 'shopping-cart', label: 'Cart', icon: ShoppingCart },
  { id: 'globe', label: 'Globe', icon: Globe },
];

const COLORS: { id: CollectionColor; class: string }[] = [
  { id: 'blue', class: 'bg-blue-500' },
  { id: 'indigo', class: 'bg-indigo-500' },
  { id: 'violet', class: 'bg-violet-500' },
  { id: 'rose', class: 'bg-rose-500' },
  { id: 'orange', class: 'bg-orange-500' },
  { id: 'amber', class: 'bg-amber-500' },
  { id: 'emerald', class: 'bg-emerald-500' },
  { id: 'teal', class: 'bg-teal-500' },
  { id: 'cyan', class: 'bg-cyan-500' },
  { id: 'pink', class: 'bg-pink-500' },
];

const PREVIEW_BG: Record<CollectionColor, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-400',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-950/40 dark:border-indigo-900 dark:text-indigo-400',
  violet: 'bg-violet-50 border-violet-200 text-violet-600 dark:bg-violet-950/40 dark:border-violet-900 dark:text-violet-400',
  rose: 'bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400',
  orange: 'bg-orange-50 border-orange-200 text-orange-600 dark:bg-orange-950/40 dark:border-orange-900 dark:text-orange-400',
  amber: 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-400',
  teal: 'bg-teal-50 border-teal-200 text-teal-600 dark:bg-teal-950/40 dark:border-teal-900 dark:text-teal-400',
  cyan: 'bg-cyan-50 border-cyan-200 text-cyan-600 dark:bg-cyan-950/40 dark:border-cyan-900 dark:text-cyan-400',
  pink: 'bg-pink-50 border-pink-200 text-pink-600 dark:bg-pink-950/40 dark:border-pink-900 dark:text-pink-400',
};

export function CollectionModal({ existing, collections, onSave, onDelete, onClose }: CollectionModalProps) {
  const [name, setName] = useState(existing?.name || '');
  const [icon, setIcon] = useState<CollectionIcon>(existing?.icon || 'folder');
  const [color, setColor] = useState<CollectionColor>(existing?.color || 'blue');
  const [parentId, setParentId] = useState<string>(existing?.parentId || '');
  const [isSaving, setIsSaving] = useState(false);

  const containerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose);

  const descendants = existing ? getCollectionDescendants(collections, existing.id) : new Set<string>();
  const validParents = flattenCollectionTree(buildCollectionTree(collections)).filter(
    (c) => c.id !== existing?.id && !descendants.has(c.id)
  );

  const PreviewIcon = ICONS.find((i) => i.id === icon)?.icon ?? Folder;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ name: name.trim(), icon, color, parentId: parentId || undefined });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="collection-modal-title"
    >
      <div
        ref={containerRef}
        className="relative w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-xl overflow-hidden animate-slide-up flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <h2 id="collection-modal-title" className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight">
            {existing ? t('editCollection') : t('newCollection')}
          </h2>
          <button
            onClick={onClose}
            className="btn-icon-sm"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar p-5 flex-1">
          <form id="collection-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${PREVIEW_BG[color]} transition-colors`}
              aria-hidden="true"
            >
              <div className="w-9 h-9 rounded-md bg-white/70 border border-white/60 dark:bg-zinc-900/50 dark:border-zinc-700 flex items-center justify-center shadow-sm">
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
              <div className="grid grid-cols-5 gap-2">
                {ICONS.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setIcon(i.id)}
                    className={`flex items-center justify-center h-9 rounded-md border transition-all ${
                      icon === i.id
                        ? 'bg-zinc-100 border-zinc-300 text-zinc-900 shadow-sm dark:bg-zinc-800 dark:border-zinc-600 dark:text-zinc-100'
                        : 'bg-white border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-300'
                    }`}
                    title={i.label}
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
                {COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    className={`w-7 h-7 rounded-full transition-transform outline-none ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ${
                      color === c.id
                        ? 'ring-zinc-900 dark:ring-zinc-100 scale-110'
                        : 'ring-transparent hover:scale-110'
                    } ${c.class}`}
                    title={c.id}
                  />
                ))}
              </div>
            </div>
          </form>
        </div>

        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center shrink-0 bg-zinc-50/50 dark:bg-zinc-800/40">
          {existing && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(existing.id)}
              className="mr-auto px-3 h-8 rounded-md text-[13px] font-medium text-rose-600 bg-rose-50 border border-rose-200 shadow-sm hover:bg-rose-100 hover:border-rose-300 dark:text-rose-400 dark:bg-rose-950/40 dark:border-rose-900 dark:hover:bg-rose-950/70 dark:hover:border-rose-800 flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('delete')}
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost-sm px-4"
            >
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
