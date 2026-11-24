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
        return { label: t('allBookmarks'), icon: LayoutGrid, colorClass: 'text-brand-600 dark:text-brand-400' };
      case COLLECTION.UNSORTED:
        return { label: t('unsorted'), icon: Inbox, colorClass: 'text-amber-500' };
      case COLLECTION.TRASH:
        return { label: t('trash'), icon: Trash2, colorClass: 'text-rose-500' };
      case SMART.PINNED:
        return { label: t('smartPinned'), icon: Pin, colorClass: 'text-brand-500' };
      case SMART.UNTAGGED:
        return { label: t('smartUntagged'), icon: Tags, colorClass: 'text-zinc-500 dark:text-zinc-400' };
      case SMART.WITH_NOTES:
        return { label: t('smartWithNotes'), icon: StickyNote, colorClass: 'text-amber-500' };
      case SMART.NO_COVER:
        return { label: t('smartNoCover'), icon: ImageOff, colorClass: 'text-zinc-500 dark:text-zinc-400' };
      case SMART.THIS_WEEK:
        return { label: t('smartThisWeek'), icon: Calendar, colorClass: 'text-emerald-500' };
      case SMART.BROKEN:
        return { label: t('smartBroken'), icon: Link2Off, colorClass: 'text-red-500' };
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
        return { label: t('allBookmarks'), icon: LayoutGrid, colorClass: 'text-brand-600 dark:text-brand-400' };
    }
  };

  const { label, icon: Icon, colorClass } = getMeta();

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-900/60 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title={t('toggleSidebar')}
            aria-label={t('toggleSidebar')}
            aria-expanded={!sidebarCollapsed}
            className="btn-icon-sm shrink-0 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        <Icon className={`w-4 h-4 shrink-0 ${colorClass}`} />

        {trail.length > 1 ? (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 min-w-0">
            {trail.map((node, idx) => {
              const isLast = idx === trail.length - 1;
              return (
                <span key={node.id} className="flex items-center gap-1 min-w-0">
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                  {isLast ? (
                    <span className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                      {node.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectCollection(node.id)}
                      className="text-[13px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 truncate transition-colors"
                    >
                      {node.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        ) : (
          <h2 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-50 truncate">
            {label}
          </h2>
        )}

        <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800 px-2 py-0.5 rounded-full tabular-nums shrink-0">
          {itemCount}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {activeCollection === COLLECTION.TRASH && itemCount > 0 && onEmptyTrash && (
          <button
            type="button"
            onClick={onEmptyTrash}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-red-600 dark:text-red-400 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/70 border border-red-200/80 dark:border-red-900 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('emptyTrash')}
          </button>
        )}

        {activeCollection === SMART.BROKEN && onCheckBroken && (
          <button
            type="button"
            onClick={onCheckBroken}
            className="btn-ghost-sm h-7 px-2.5 text-[12px]"
          >
            <Link2Off className="w-3.5 h-3.5" />
            {t('checkBroken')}
          </button>
        )}

        {activeCollection === SMART.NO_COVER && itemCount > 0 && onRefreshPreviews && (
          <button
            type="button"
            onClick={onRefreshPreviews}
            className="btn-ghost-sm h-7 px-2.5 text-[12px]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('fetchPreviews')}
          </button>
        )}

        {activeCustom && itemCount > 0 && onOpenAll && (
          <button
            type="button"
            onClick={onOpenAll}
            className="btn-ghost-sm h-7 px-2.5 text-[12px]"
            title={`${t('openAll')} (${itemCount})`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('openAll')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
