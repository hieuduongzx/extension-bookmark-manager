import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Settings,
  Cloud,
  FolderPlus,
  Layers,
  Sun,
  Moon,
  Monitor,
  LayoutGrid,
  LayoutList,
  LayoutDashboard,
  FolderTree,
  ExternalLink,
  Link2Off,
  RefreshCw,
  Pin,
  Inbox,
  Trash2,
  Tags,
  StickyNote,
  Copy,
  Calendar,
  ImageOff,
  CornerDownLeft,
} from 'lucide-react';
import type { Bookmark, Collection, LocaleCode, ThemeMode, ViewMode } from '../types';
import { COLLECTION, SMART } from '../types';
import { createT } from '../i18n';
import { fuzzyMatch, getDomain, getFavicon, getFaviconFallback } from '../utils';
import { getCollectionColorText, getCollectionIcon } from '../collectionIcons';
import { useEscapeKey, useFocusTrap } from '../hooks';

interface CommandItem {
  id: string;
  section: 'actions' | 'collections' | 'bookmarks';
  label: string;
  subtitle?: string;
  icon?: React.ElementType;
  iconClass?: string;
  favicon?: string;
  url?: string;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  bookmarks: Bookmark[];
  collections: Collection[];
  locale: LocaleCode;
  theme: ThemeMode;
  allowFolderView: boolean;
  onClose: () => void;
  onSelectCollection: (id: string) => void;
  onAddBookmark: () => void;
  onNewCollection: () => void;
  onSaveAllTabs: () => void;
  onOpenSettings: () => void;
  onSyncGDrive: () => void;
  onCycleTheme: () => void;
  onChangeView: (mode: ViewMode) => void;
  onCheckBroken: () => void;
  onRefreshPreviews: () => void;
}

export function CommandPalette({
  bookmarks,
  collections,
  locale,
  theme,
  allowFolderView,
  onClose,
  onSelectCollection,
  onAddBookmark,
  onNewCollection,
  onSaveAllTabs,
  onOpenSettings,
  onSyncGDrive,
  onCycleTheme,
  onChangeView,
  onCheckBroken,
  onRefreshPreviews,
}: CommandPaletteProps) {
  const t = createT(locale);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim();
    const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
    const themeLabel =
      theme === 'dark' ? t('themeDark') : theme === 'light' ? t('themeLight') : t('themeSystem');

    const actions: CommandItem[] = [
      {
        id: 'act-add',
        section: 'actions',
        label: t('addBookmark'),
        icon: Plus,
        shortcut: 'N',
        onSelect: () => {
          onClose();
          onAddBookmark();
        },
      },
      {
        id: 'act-save-tabs',
        section: 'actions',
        label: t('saveAllTabs'),
        icon: Layers,
        onSelect: () => {
          onClose();
          onSaveAllTabs();
        },
      },
      {
        id: 'act-new-col',
        section: 'actions',
        label: t('newCollection'),
        icon: FolderPlus,
        onSelect: () => {
          onClose();
          onNewCollection();
        },
      },
      {
        id: 'act-theme',
        section: 'actions',
        label: t('switchTheme', { mode: themeLabel }),
        icon: ThemeIcon,
        onSelect: () => {
          onCycleTheme();
        },
      },
      {
        id: 'act-view-list',
        section: 'actions',
        label: t('viewList'),
        icon: LayoutList,
        onSelect: () => {
          onChangeView('list');
          onClose();
        },
      },
      {
        id: 'act-view-grid',
        section: 'actions',
        label: t('viewGrid'),
        icon: LayoutGrid,
        onSelect: () => {
          onChangeView('grid');
          onClose();
        },
      },
      {
        id: 'act-view-icon',
        section: 'actions',
        label: t('viewMasonry'),
        icon: LayoutDashboard,
        onSelect: () => {
          onChangeView('masonry');
          onClose();
        },
      },
      ...(allowFolderView
        ? [
            {
              id: 'act-view-folder',
              section: 'actions' as const,
              label: t('viewFolder'),
              icon: FolderTree,
              onSelect: () => {
                onChangeView('folder');
                onClose();
              },
            },
          ]
        : []),
      {
        id: 'act-sync',
        section: 'actions',
        label: t('gdriveMenuSync'),
        icon: Cloud,
        onSelect: () => {
          onClose();
          onSyncGDrive();
        },
      },
      {
        id: 'act-broken',
        section: 'actions',
        label: t('checkBroken'),
        icon: Link2Off,
        onSelect: () => {
          onClose();
          onCheckBroken();
        },
      },
      {
        id: 'act-previews',
        section: 'actions',
        label: t('fetchPreviews'),
        icon: RefreshCw,
        onSelect: () => {
          onClose();
          onRefreshPreviews();
        },
      },
      {
        id: 'act-settings',
        section: 'actions',
        label: t('settings'),
        icon: Settings,
        onSelect: () => {
          onClose();
          onOpenSettings();
        },
      },
    ];

    const systemCols: CommandItem[] = [
      { id: COLLECTION.ALL, section: 'collections', label: t('allBookmarks'), icon: LayoutGrid, onSelect: () => { onSelectCollection(COLLECTION.ALL); onClose(); } },
      { id: COLLECTION.UNSORTED, section: 'collections', label: t('unsorted'), icon: Inbox, onSelect: () => { onSelectCollection(COLLECTION.UNSORTED); onClose(); } },
      { id: SMART.PINNED, section: 'collections', label: t('smartPinned'), icon: Pin, onSelect: () => { onSelectCollection(SMART.PINNED); onClose(); } },
      { id: SMART.WITH_NOTES, section: 'collections', label: t('smartWithNotes'), icon: StickyNote, onSelect: () => { onSelectCollection(SMART.WITH_NOTES); onClose(); } },
      { id: SMART.UNTAGGED, section: 'collections', label: t('smartUntagged'), icon: Tags, onSelect: () => { onSelectCollection(SMART.UNTAGGED); onClose(); } },
      { id: SMART.THIS_WEEK, section: 'collections', label: t('smartThisWeek'), icon: Calendar, onSelect: () => { onSelectCollection(SMART.THIS_WEEK); onClose(); } },
      { id: SMART.NO_COVER, section: 'collections', label: t('smartNoCover'), icon: ImageOff, onSelect: () => { onSelectCollection(SMART.NO_COVER); onClose(); } },
      { id: SMART.BROKEN, section: 'collections', label: t('smartBroken'), icon: Link2Off, onSelect: () => { onSelectCollection(SMART.BROKEN); onClose(); } },
      { id: SMART.DUPLICATES, section: 'collections', label: t('smartDuplicates'), icon: Copy, onSelect: () => { onSelectCollection(SMART.DUPLICATES); onClose(); } },
      { id: COLLECTION.TRASH, section: 'collections', label: t('trash'), icon: Trash2, onSelect: () => { onSelectCollection(COLLECTION.TRASH); onClose(); } },
      ...collections.map((c) => ({
        id: `col-${c.id}`,
        section: 'collections' as const,
        label: c.name,
        icon: getCollectionIcon(c.icon),
        iconClass: getCollectionColorText(c.color),
        onSelect: () => {
          onSelectCollection(c.id);
          onClose();
        },
      })),
    ];

    const nonTrash = bookmarks.filter((b) => b.collectionId !== COLLECTION.TRASH);
    const matchedBookmarks: CommandItem[] = (
      q
        ? nonTrash.filter((b) =>
            fuzzyMatch(q, `${b.title} ${b.url} ${b.tags.join(' ')} ${b.note || ''}`)
          )
        : nonTrash.filter((b) => b.pinned).concat(nonTrash.filter((b) => !b.pinned))
    )
      .slice(0, q ? 12 : 6)
      .map((b) => ({
        id: `bm-${b.id}`,
        section: 'bookmarks',
        label: b.title || getDomain(b.url),
        subtitle: getDomain(b.url),
        favicon: b.favicon || getFavicon(b.url),
        url: b.url,
        onSelect: () => {
          window.open(b.url, '_blank', 'noopener,noreferrer');
          onClose();
        },
      }));

    if (!q) {
      return [...actions.slice(0, 6), ...systemCols.slice(0, 5), ...matchedBookmarks];
    }

    const matchedActions = actions.filter((a) => fuzzyMatch(q, a.label));
    const matchedCols = systemCols.filter((c) => fuzzyMatch(q, c.label));
    return [...matchedBookmarks, ...matchedCols, ...matchedActions];
  }, [
    query,
    bookmarks,
    collections,
    theme,
    allowFolderView,
    t,
    onClose,
    onAddBookmark,
    onSaveAllTabs,
    onNewCollection,
    onCycleTheme,
    onChangeView,
    onSyncGDrive,
    onCheckBroken,
    onRefreshPreviews,
    onOpenSettings,
    onSelectCollection,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[activeIndex]?.onSelect();
    }
  };

  const sectionLabel = (section: CommandItem['section']) => {
    if (section === 'actions') return t('commandSectionActions');
    if (section === 'collections') return t('commandSectionCollections');
    return t('commandSectionBookmarks');
  };

  let lastSection: CommandItem['section'] | null = null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4 bg-zinc-900/45 dark:bg-black/65 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('commandPalette')}
    >
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-pop overflow-hidden animate-scale-in flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('commandPlaceholder')}
            className="flex-1 bg-transparent text-[13.5px] font-medium text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {items.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
              {t('commandNoResults')}
            </div>
          ) : (
            items.map((item, idx) => {
              const showHeading = item.section !== lastSection;
              lastSection = item.section;
              const isSelected = idx === activeIndex;
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {showHeading && (
                    <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {sectionLabel(item.section)}
                    </div>
                  )}
                  <button
                    type="button"
                    data-cmd-idx={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onSelect}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-brand-50 text-brand-900 dark:bg-brand-950/60 dark:text-brand-100'
                        : 'text-zinc-700 hover:bg-zinc-100/80 dark:text-zinc-200 dark:hover:bg-zinc-800/70'
                    }`}
                  >
                    {item.favicon ? (
                      <img
                        src={item.favicon}
                        alt=""
                        className="w-4 h-4 rounded-sm shrink-0"
                        onError={(e) => {
                          if (item.url) {
                            (e.target as HTMLImageElement).src = getFaviconFallback(item.url);
                          }
                        }}
                      />
                    ) : Icon ? (
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isSelected
                            ? 'text-brand-600 dark:text-brand-400'
                            : item.iconClass || 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      />
                    ) : null}
                    <span className="flex-1 min-w-0 truncate text-[13px] font-medium">
                      {item.label}
                    </span>
                    {item.subtitle && (
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate max-w-[140px]">
                        {item.subtitle}
                      </span>
                    )}
                    {item.url && isSelected && (
                      <ExternalLink className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                    )}
                    {item.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/30 flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-mono text-[10px]">↑↓</kbd>
              {t('shortcutNavigate')}
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" />
              Enter
            </span>
          </div>
          <span>Ctrl/⌘+K</span>
        </div>
      </div>
    </div>
  );
}
