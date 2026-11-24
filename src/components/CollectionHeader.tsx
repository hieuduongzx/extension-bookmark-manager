import {
  ChevronRight,
  LayoutGrid,
  Inbox,
  Trash2,
  Pin,
  Tags,
  StickyNote,
  ImageOff,
  Calendar,
  Link2Off,
  Copy,
  ExternalLink,
  RefreshCw,
  PanelLeft,
} from 'lucide-react';
import type { Collection, LocaleCode } from '../types';
import { COLLECTION, SMART } from '../types';
import { createT } from '../i18n';
import { getCollectionPath } from '../utils';
import { getCollectionColorText, getCollectionIcon } from '../collectionIcons';
import { Button } from './ui/Button';

interface CollectionHeaderProps {
  activeCollection: string;
  collections: Collection[];
  itemCount: number;
  locale: LocaleCode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onSelectCollection: (id: string) => void;
  onEmptyTrash?: () => void;
  onOpenAll?: () => void;
  onCheckBroken?: () => void;
  onRefreshPreviews?: () => void;
}

export function CollectionHeader({
  activeCollection,
  collections,
  itemCount,
  locale,
  sidebarCollapsed,
  onToggleSidebar,
  onSelectCollection,
  onEmptyTrash,
  onOpenAll,
  onCheckBroken,
  onRefreshPreviews,
}: CollectionHeaderProps) {
  const t = createT(locale);

  const trail = getCollectionPath(collections, activeCollection);
  const activeCustom = trail[trail.length - 1];

  const getMeta = (): { label: string; icon: React.ElementType; colorClass: string } => {
    switch (activeCollection) {
      case COLLECTION.ALL:
        return { label: t('allBookmarks'), icon: LayoutGrid, colorClass: 'text-[var(--accent)]' };
      case COLLECTION.UNSORTED:
        return { label: t('unsorted'), icon: Inbox, colorClass: 'text-amber-500' };
      case COLLECTION.TRASH:
        return { label: t('trash'), icon: Trash2, colorClass: 'text-rose-500' };
      case SMART.PINNED:
        return { label: t('smartPinned'), icon: Pin, colorClass: 'text-[var(--accent)]' };
      case SMART.UNTAGGED:
        return { label: t('smartUntagged'), icon: Tags, colorClass: 'text-[var(--text-muted)]' };
      case SMART.WITH_NOTES:
        return { label: t('smartWithNotes'), icon: StickyNote, colorClass: 'text-amber-500' };
      case SMART.NO_COVER:
        return { label: t('smartNoCover'), icon: ImageOff, colorClass: 'text-[var(--text-muted)]' };
      case SMART.THIS_WEEK:
        return { label: t('smartThisWeek'), icon: Calendar, colorClass: 'text-emerald-500' };
      case SMART.BROKEN:
        return { label: t('smartBroken'), icon: Link2Off, colorClass: 'text-[var(--danger)]' };
      case SMART.DUPLICATES:
        return { label: t('smartDuplicates'), icon: Copy, colorClass: 'text-orange-500' };
      default:
        if (activeCustom) {
          return {
            label: activeCustom.name,
            icon: getCollectionIcon(activeCustom.icon),
            colorClass: getCollectionColorText(activeCustom.color),
          };
        }
        return { label: t('allBookmarks'), icon: LayoutGrid, colorClass: 'text-[var(--accent)]' };
    }
  };

  const { label, icon: Icon, colorClass } = getMeta();

  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 bg-[var(--bg)] shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        {onToggleSidebar && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleSidebar}
            title={t('toggleSidebar')}
            aria-label={t('toggleSidebar')}
            aria-expanded={!sidebarCollapsed}
          >
            <PanelLeft size={16} />
          </Button>
        )}

        <Icon className={`w-[18px] h-[18px] shrink-0 ${colorClass}`} />

        {trail.length > 1 ? (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 min-w-0">
            {trail.map((node, idx) => {
              const isLast = idx === trail.length - 1;
              return (
                <span key={node.id} className="flex items-center gap-1 min-w-0">
                  {idx > 0 && (
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                  )}
                  {isLast ? (
                    <span className="text-[16px] font-semibold text-[var(--text)] truncate">
                      {node.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectCollection(node.id)}
                      className="text-[14px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] truncate transition-colors"
                    >
                      {node.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        ) : (
          <h2 className="text-[16px] font-semibold text-[var(--text)] truncate m-0">{label}</h2>
        )}

        <span className="text-[11.5px] font-semibold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] px-2 py-0.5 rounded-full tabular-nums shrink-0">
          {itemCount}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {activeCollection === COLLECTION.TRASH && itemCount > 0 && onEmptyTrash && (
          <Button variant="danger-subtle" size="sm" onClick={onEmptyTrash}>
            <Trash2 size={13} />
            <span>{t('emptyTrash')}</span>
          </Button>
        )}

        {activeCollection === SMART.BROKEN && onCheckBroken && (
          <Button variant="secondary" size="sm" onClick={onCheckBroken}>
            <Link2Off size={13} />
            <span>{t('checkBroken')}</span>
          </Button>
        )}

        {activeCollection === SMART.NO_COVER && itemCount > 0 && onRefreshPreviews && (
          <Button variant="secondary" size="sm" onClick={onRefreshPreviews}>
            <RefreshCw size={13} />
            <span>{t('fetchPreviews')}</span>
          </Button>
        )}

        {activeCustom && itemCount > 0 && onOpenAll && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenAll}
            title={`${t('openAll')} (${itemCount})`}
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">{t('openAll')}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
