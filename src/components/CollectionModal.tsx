import { useMemo, useState } from 'react';
import { Folder, Image as ImageIcon, Palette, Trash2 } from 'lucide-react';
import type { Collection, CollectionColor, CollectionIcon, LocaleCode } from '../types';
import { buildCollectionTree, flattenCollectionTree, getCollectionDescendants } from '../utils';
import { createT } from '../i18n';
import { Dropdown } from './Dropdown';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
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
    <Dialog
      open={true}
      title={existing ? t('editCollection') : t('newCollection')}
      onClose={onClose}
      closeLabel={t('close')}
      maxWidth={420}
      footer={
        <div className="flex items-center w-full gap-2">
          {existing && onDelete && (
            <Button
              variant="danger-subtle"
              size="sm"
              className="mr-auto"
              onClick={() => onDelete(existing.id)}
            >
              <Trash2 size={14} />
              <span>{t('delete')}</span>
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="collection-form"
              variant="primary"
              size="sm"
              disabled={isSaving || !name.trim()}
            >
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="collection-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isSaving && name.trim()) {
            e.preventDefault();
            void submitForm();
          }
        }}
      >
        {/* Live Preview (*2k opt-icon-preview-bar) */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)]"
          aria-hidden="true"
        >
          <div
            className={`w-9 h-9 rounded-[var(--radius)] border flex items-center justify-center shrink-0 ${COLLECTION_BADGE_BG[color]}`}
          >
            <PreviewIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-[var(--text)] truncate m-0">
              {name.trim() || t('collectionNameLabel')}
            </p>
            <p className="text-[11.5px] text-[var(--text-muted)] m-0">{t('livePreview')}</p>
          </div>
        </div>

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <Folder size={13} /> {t('name')}
          </label>
          <input
            autoFocus
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ui-input w-full"
            placeholder={t('collectionNamePlaceholder')}
          />
        </div>

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <Folder size={13} /> {t('parentCollection')}
          </label>
          <Dropdown
            size="sm"
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

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <ImageIcon size={13} /> {t('icon')}
          </label>
          <div className="grid grid-cols-8 gap-1.5">
            {COLLECTION_ICONS.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setIcon(i.id)}
                className={`flex items-center justify-center h-8 rounded-[var(--radius)] border transition-colors ${
                  icon === i.id
                    ? 'bg-[rgba(59,130,246,0.14)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                }`}
                title={i.label}
                aria-label={i.label}
              >
                <i.icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="ui-label flex items-center gap-1.5">
            <Palette size={13} /> {t('color')}
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLLECTION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setColor(c.id)}
                className={`w-6 h-6 rounded-full transition-transform outline-none border-2 ${
                  color === c.id
                    ? 'border-[var(--text)] scale-110'
                    : 'border-transparent hover:scale-105'
                } ${c.swatch}`}
                title={c.id}
                aria-label={c.id}
              />
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
