import { memo, useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreHorizontal,
  Edit,
  Trash2,
  ExternalLink,
  RefreshCw,
  CheckSquare,
  Square,
  Pin,
  GripVertical,
  CornerDownRight,
  Copy,
  Check,
  Folder,
  Hash,
  ArrowUpRight,
} from 'lucide-react';
import type { Bookmark, LocaleCode } from '../types';
import {
  formatRelativeDate,
  getDomain,
  getDomainCoverTint,
  getFavicon,
  getFaviconFallback,
  isBrokenLink,
} from '../utils';
import { useEscapeKey } from '../hooks';
import { createT } from '../i18n';

export type ReorderPosition = 'before' | 'after';

interface BookmarkCardProps {
  bookmark: Bookmark;
  viewMode: 'grid' | 'list' | 'masonry';
  relatedRoot?: Bookmark;
  collectionName?: string;
  onCollectionClick?: (collectionId: string) => void;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  onCopyUrl?: (url: string) => void;
  isTrash?: boolean;
  isSelected?: boolean;
  isFocused?: boolean;
  onToggleSelect?: (id: string, selected: boolean, shiftKey?: boolean) => void;
  onTogglePin?: (id: string) => void;
  isSelectMode?: boolean;
  onTagClick?: (tag: string) => void;
  highlightQuery?: string;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  locale?: LocaleCode;
}

function HighlightText({ text, query }: { text: string; query?: string }) {
  const q = query?.trim();
  if (!q || q.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[rgba(59,130,246,0.2)] text-[var(--text)] rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ─── Actions Popover Menu (*2k tokens) ───────────────────────────────────────

interface ActionsMenuProps {
  bookmark: Bookmark;
  isTrash?: boolean;
  menuRef: React.RefObject<HTMLDivElement>;
  anchorRef: React.RefObject<HTMLButtonElement>;
  anchorPoint?: { x: number; y: number } | null;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onCopyUrl: () => void;
  onClose: () => void;
  locale: LocaleCode;
}

function ActionsMenu({
  bookmark,
  isTrash,
  menuRef,
  anchorRef,
  anchorPoint,
  onEdit,
  onDelete,
  onRestore,
  onTogglePin,
  onCopyUrl,
  onClose,
  locale,
}: ActionsMenuProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEscapeKey(onClose);

  useEffect(() => {
    if (!pos) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    const anchor = anchorRef.current;
    return () => {
      if (!anchorPoint && anchor?.isConnected) anchor.focus();
    };
  }, [pos, menuRef, anchorRef, anchorPoint]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  useLayoutEffect(() => {
    const update = () => {
      const menuWidth = 192;
      const menuHeight = 228;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let top: number;
      let left: number;

      if (anchorPoint) {
        top = anchorPoint.y + 2;
        left = anchorPoint.x + 2;
      } else {
        const btn = anchorRef.current;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        top = rect.bottom + 4;
        left = rect.right - menuWidth;
      }

      if (left < margin) left = margin;
      if (left + menuWidth > vw - margin) left = vw - menuWidth - margin;

      if (top + menuHeight > vh - margin) {
        if (anchorPoint) {
          top = Math.max(margin, anchorPoint.y - menuHeight - 2);
        } else {
          const btn = anchorRef.current;
          top = btn ? Math.max(margin, btn.getBoundingClientRect().top - menuHeight - 4) : margin;
        }
      }

      setPos({ top, left });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, anchorPoint]);

  if (!pos) return null;

  const openBackground = () => {
    onClose();
    if (chrome?.tabs?.create) {
      void chrome.tabs.create({ url: bookmark.url, active: false });
    } else {
      window.open(bookmark.url, '_blank', 'noopener,noreferrer');
    }
  };

  const itemClass =
    'flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-[var(--text)] hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] rounded-[6px] cursor-pointer font-medium transition-colors w-full text-left focus:outline-none';

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Bookmark actions"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 192 }}
      className="bg-[var(--surface)] border border-[var(--border)] shadow-pop rounded-[var(--radius)] overflow-hidden z-[1000] animate-scale-in focus:outline-none"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      <div className="p-1 flex flex-col gap-0.5">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={itemClass}
        >
          <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          {t('openLink')}
        </a>
        <button type="button" role="menuitem" onClick={openBackground} className={itemClass}>
          <ArrowUpRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          {t('openBackgroundTab')}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onCopyUrl();
          }}
          className={itemClass}
        >
          <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          {t('copyUrl')}
        </button>
        {!isTrash && onTogglePin && (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onTogglePin(bookmark.id);
            }}
            className={itemClass}
          >
            <Pin
              className={`w-3.5 h-3.5 ${
                bookmark.pinned ? 'text-[var(--accent)] fill-current' : 'text-[var(--text-muted)]'
              }`}
            />
            {bookmark.pinned ? t('unpin') : t('pin')}
          </button>
        )}
        {!isTrash && (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onEdit(bookmark);
            }}
            className={itemClass}
          >
            <Edit className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            {t('edit')}
          </button>
        )}
        {isTrash && (
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onRestore(bookmark.id);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-[var(--accent)] hover:bg-[rgba(59,130,246,0.12)] focus:bg-[rgba(59,130,246,0.12)] rounded-[6px] cursor-pointer font-medium transition-colors w-full text-left focus:outline-none"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('restore')}
          </button>
        )}
        <div className="h-[1px] bg-[var(--border)] my-0.5 mx-1" />
        <button
          type="button"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onDelete(bookmark.id, !!isTrash);
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.1)] focus:bg-[rgba(239,68,68,0.1)] rounded-[6px] cursor-pointer font-medium transition-colors w-full text-left focus:outline-none"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {isTrash ? t('deletePermanently') : t('moveToTrash')}
        </button>
      </div>
    </div>,
    document.body
  );
}

interface CheckboxToggleProps {
  bookmarkId: string;
  isSelected: boolean;
  onToggleSelect?: (id: string, selected: boolean, shiftKey?: boolean) => void;
}

function CheckboxToggle({ bookmarkId, isSelected, onToggleSelect }: CheckboxToggleProps) {
  if (!onToggleSelect) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect(bookmarkId, !isSelected, e.shiftKey);
      }}
      aria-label={isSelected ? 'Deselect bookmark' : 'Select bookmark'}
      className={`p-1 rounded-[6px] transition-colors bg-[var(--surface)]/90 ${
        isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
      }`}
    >
      {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
    </button>
  );
}

interface PinButtonProps {
  bookmarkId: string;
  isPinned: boolean;
  onTogglePin?: (id: string) => void;
  locale: LocaleCode;
  surface?: boolean;
}

function PinButton({ bookmarkId, isPinned, onTogglePin, locale, surface = false }: PinButtonProps) {
  if (!onTogglePin) return null;
  const t = createT(locale);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTogglePin(bookmarkId);
      }}
      className={`p-1.5 rounded-[6px] transition-opacity ${
        surface
          ? 'bg-[var(--surface)]/95 border border-[var(--border)]'
          : 'hover:bg-[var(--surface-2)]'
      } ${
        isPinned
          ? 'opacity-100 text-[var(--accent)]'
          : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)]'
      }`}
      title={isPinned ? t('unpinBookmark') : t('pinBookmark')}
      aria-label={isPinned ? t('unpinBookmark') : t('pinBookmark')}
    >
      <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function BookmarkCardInner({
  bookmark,
  viewMode,
  relatedRoot,
  collectionName,
  onCollectionClick,
  onEdit,
  onDelete,
  onRestore,
  onCopyUrl,
  isTrash,
  isSelected = false,
  isFocused = false,
  onToggleSelect,
  onTogglePin,
  isSelectMode = false,
  onTagClick,
  highlightQuery,
  compact = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  locale = 'en',
}: BookmarkCardProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [showMenu, setShowMenu] = useState(false);
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<'top' | 'bottom' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const hostname = getDomain(bookmark.url);
  const faviconUrl = bookmark.favicon || getFavicon(bookmark.url);
  const relatedTitle = relatedRoot?.title || (relatedRoot ? getDomain(relatedRoot.url) : '');
  const relativeDate = formatRelativeDate(bookmark.createdAt, locale);

  useEffect(() => {
    setCoverFailed(false);
  }, [bookmark.coverUrl]);

  const closeMenu = useCallback(() => {
    setShowMenu(false);
    setContextPoint(null);
  }, []);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(bookmark.url);
      setCopied(true);
      onCopyUrl?.(bookmark.url);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  }, [bookmark.url, onCopyUrl]);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        (!btnRef.current || !btnRef.current.contains(e.target as Node))
      ) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu, closeMenu]);

  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      if (isSelectMode) {
        onToggleSelect?.(bookmark.id, !isSelected, e.shiftKey);
        return;
      }
      window.open(bookmark.url, '_blank', 'noopener,noreferrer');
    },
    [bookmark.url, bookmark.id, isSelectMode, isSelected, onToggleSelect]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextPoint({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      if (isSelectMode) {
        onToggleSelect?.(bookmark.id, !isSelected, e.shiftKey);
      } else {
        window.open(bookmark.url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  // ─── Icon / Masonry View ────────────────────────────────────────────────────
  if (viewMode === 'masonry') {
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/bookmark-id', bookmark.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={`Open ${bookmark.title || hostname}`}
        className={`group flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-[var(--radius-lg)] border transition-colors duration-150 cursor-pointer relative focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          isSelected
            ? 'bg-[rgba(59,130,246,0.1)] border-[var(--accent)]'
            : isFocused
              ? 'bg-[var(--surface)] border-[var(--accent)] ring-2 ring-[rgba(59,130,246,0.2)]'
              : 'bg-[var(--surface)] border-[var(--border)] hover:bg-[var(--surface-2)]'
        }`}
        title={`${bookmark.title || hostname}\n${bookmark.url}`}
      >
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
          {isBrokenLink(bookmark) && (
            <span className="w-2 h-2 rounded-full bg-[var(--danger)]" title={t('brokenBadge')} />
          )}
        </div>

        <div className="absolute top-1 right-1 z-10 flex flex-col gap-0.5 items-end">
          <CheckboxToggle
            bookmarkId={bookmark.id}
            isSelected={isSelected}
            onToggleSelect={isSelectMode ? onToggleSelect : undefined}
          />
          {!isTrash && (
            <PinButton
              bookmarkId={bookmark.id}
              isPinned={!!bookmark.pinned}
              onTogglePin={onTogglePin}
              locale={locale}
            />
          )}
        </div>

        <div className="w-11 h-11 rounded-[var(--radius-lg)] shrink-0 bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center overflow-hidden">
          <img
            src={faviconUrl}
            alt=""
            loading="lazy"
            className="w-6 h-6"
            onError={(e) => {
              (e.target as HTMLImageElement).src = getFaviconFallback(bookmark.url);
            }}
          />
        </div>

        <span className="text-[11.5px] font-medium text-[var(--text)] line-clamp-2 text-center max-w-full px-0.5 leading-tight break-words">
          <HighlightText text={bookmark.title || hostname} query={highlightQuery} />
        </span>

        <div className="absolute bottom-1 right-1 z-10">
          <button
            ref={btnRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextPoint(null);
              setShowMenu((v) => !v);
            }}
            aria-label="More actions"
            className={`p-1 rounded-[6px] transition-opacity bg-[var(--surface)]/95 ${
              showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
            } text-[var(--text-muted)] hover:text-[var(--text)]`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        {showMenu && (
          <ActionsMenu
            bookmark={bookmark}
            isTrash={isTrash}
            menuRef={menuRef}
            anchorRef={btnRef}
            anchorPoint={contextPoint}
            onEdit={onEdit}
            onDelete={onDelete}
            onRestore={onRestore}
            onTogglePin={onTogglePin}
            onCopyUrl={handleCopyUrl}
            onClose={closeMenu}
            locale={locale}
          />
        )}
      </div>
    );
  }

  // ─── List View (*2k clean row inside unified card surface) ──────────────────
  if (viewMode === 'list') {
    const visibleTags = compact ? [] : bookmark.tags.slice(0, 3);
    const extraTags = compact ? 0 : Math.max(0, bookmark.tags.length - 3);

    return (
      <div
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/bookmark-id', bookmark.id);
          e.dataTransfer.effectAllowed = 'move';
          setIsDragging(true);
          onDragStart?.(e);
        }}
        onDragEnd={() => {
          setIsDragging(false);
          setDropIndicator(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          setDropIndicator(e.clientY < midpoint ? 'top' : 'bottom');
          onDragOver?.(e);
        }}
        onDragLeave={() => setDropIndicator(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDropIndicator(null);
          onDrop?.(e);
        }}
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={`Open ${bookmark.title || hostname}`}
        className={`group flex items-center gap-3 ${
          compact
            ? 'px-2.5 py-2 rounded-[var(--radius)] border border-transparent hover:border-[var(--border)]'
            : 'px-4 py-3'
        } transition-colors duration-120 cursor-pointer relative focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
          isSelected
            ? 'bg-[rgba(59,130,246,0.1)]'
            : isFocused
              ? 'bg-[rgba(59,130,246,0.08)] ring-1 ring-inset ring-[var(--accent)]'
              : 'bg-transparent hover:bg-[var(--surface-2)]/70'
        } ${isDragging ? 'opacity-40' : 'opacity-100'}`}
      >
        {dropIndicator === 'top' && (
          <span className="absolute -top-px left-0 right-0 h-0.5 bg-[var(--accent)] pointer-events-none z-10" />
        )}
        {dropIndicator === 'bottom' && (
          <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-[var(--accent)] pointer-events-none z-10" />
        )}

        <div className="flex items-center gap-3 min-w-0 flex-1">
          {draggable && !isSelectMode && (
            <div
              className="text-[var(--text-muted)] opacity-0 group-hover:opacity-70 hover:!opacity-100 cursor-grab active:cursor-grabbing shrink-0 select-none transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </div>
          )}
          <CheckboxToggle
            bookmarkId={bookmark.id}
            isSelected={isSelected}
            onToggleSelect={isSelectMode ? onToggleSelect : undefined}
          />

          {/* Favicon */}
          <div
            className={`${
              compact ? 'w-7 h-7 rounded-[6px]' : 'w-9 h-9 rounded-[var(--radius)]'
            } shrink-0 bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center overflow-hidden`}
          >
            <img
              src={faviconUrl}
              alt=""
              loading="lazy"
              className={compact ? 'w-4 h-4' : 'w-5 h-5'}
              onError={(e) => {
                (e.target as HTMLImageElement).src = getFaviconFallback(bookmark.url);
              }}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <h3
                className="text-[13.5px] font-semibold text-[var(--text)] truncate min-w-0 m-0"
                title={bookmark.title || hostname}
              >
                <HighlightText text={bookmark.title || hostname} query={highlightQuery} />
              </h3>

              {isBrokenLink(bookmark) && (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[rgba(239,68,68,0.14)] text-[var(--danger)]">
                  {t('brokenBadge')}
                </span>
              )}

              {relatedRoot && (
                <span
                  className="shrink-0 hidden sm:inline-flex items-center gap-0.5 text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.24)] text-[var(--accent)] max-w-[140px] truncate"
                  title={`${t('subPageOf')}: ${relatedTitle}\n${relatedRoot.url}`}
                >
                  <CornerDownRight className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{relatedTitle}</span>
                </span>
              )}
            </div>

            {/* Meta row: domain · collection · tags · date */}
            <div className="flex items-center gap-2 min-w-0 text-[12px] text-[var(--text-muted)]">
              <span className="truncate max-w-[200px]" title={bookmark.url}>
                {hostname}
              </span>

              {!compact && collectionName && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCollectionClick?.(bookmark.collectionId);
                  }}
                  className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] shrink-0 max-w-[130px] transition-colors"
                >
                  <Folder className="w-2.5 h-2.5 opacity-75 shrink-0" />
                  <span className="truncate">{collectionName}</span>
                </button>
              )}

              {visibleTags.length > 0 && (
                <div className="hidden md:flex items-center gap-1 shrink-0">
                  {visibleTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTagClick?.(tag);
                      }}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[rgba(59,130,246,0.12)] hover:bg-[rgba(59,130,246,0.2)] text-[11px] font-medium text-[var(--accent)] transition-colors"
                    >
                      <Hash className="w-2.5 h-2.5 opacity-65" />
                      {tag}
                    </button>
                  ))}
                  {extraTags > 0 && (
                    <span className="text-[11px] text-[var(--text-muted)] font-medium">
                      +{extraTags}
                    </span>
                  )}
                </div>
              )}

              {!compact && (
                <span className="hidden lg:inline text-[11.5px] text-[var(--text-muted)] shrink-0 ml-auto tabular-nums">
                  {relativeDate}
                </span>
              )}
            </div>

            {!compact && bookmark.note && (
              <p className="text-[12px] text-[var(--text-muted)] truncate mt-0.5 m-0">
                {bookmark.note}
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="shrink-0 flex items-center gap-0.5">
          {!compact && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleCopyUrl();
              }}
              className={`p-1.5 rounded-[6px] transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100 ${
                copied
                  ? 'opacity-100 text-[var(--success)] bg-[rgba(34,197,94,0.12)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
              title={copied ? t('copied') : t('copyUrl')}
              aria-label={t('copyUrl')}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          {!isTrash && (
            <PinButton
              bookmarkId={bookmark.id}
              isPinned={!!bookmark.pinned}
              onTogglePin={onTogglePin}
              locale={locale}
            />
          )}
          {!compact && !isTrash && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(bookmark);
              }}
              className="p-1.5 rounded-[6px] opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-opacity"
              title={t('edit')}
              aria-label={t('edit')}
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            ref={btnRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextPoint(null);
              setShowMenu((v) => !v);
            }}
            aria-label="More actions"
            className={`p-1.5 rounded-[6px] transition-opacity ${
              showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
            } text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {showMenu && (
          <ActionsMenu
            bookmark={bookmark}
            isTrash={isTrash}
            menuRef={menuRef}
            anchorRef={btnRef}
            anchorPoint={contextPoint}
            onEdit={onEdit}
            onDelete={onDelete}
            onRestore={onRestore}
            onTogglePin={onTogglePin}
            onCopyUrl={handleCopyUrl}
            onClose={closeMenu}
            locale={locale}
          />
        )}
      </div>
    );
  }

  // ─── Grid (Card) View (*2k surface card, zero hover jump) ──────────────────
  const visibleTags = bookmark.tags.slice(0, 3);
  const extraTags = Math.max(0, bookmark.tags.length - 3);
  const hasCover = Boolean(bookmark.coverUrl) && !coverFailed;
  const fallbackTint = getDomainCoverTint(bookmark.url);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/bookmark-id', bookmark.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={handleCardClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${bookmark.title || hostname}`}
      className={`group flex flex-col rounded-[var(--radius-lg)] border transition-colors duration-150 cursor-pointer relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        isSelected
          ? 'bg-[rgba(59,130,246,0.08)] border-[var(--accent)] ring-1 ring-[rgba(59,130,246,0.3)]'
          : isFocused
            ? 'bg-[var(--surface)] border-[var(--accent)] ring-2 ring-[rgba(59,130,246,0.2)]'
            : 'bg-[var(--surface)] border-[var(--border)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]'
      }`}
    >
      {/* Floating Top-Right Quick Actions */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {isSelectMode && (
          <CheckboxToggle
            bookmarkId={bookmark.id}
            isSelected={isSelected}
            onToggleSelect={onToggleSelect}
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleCopyUrl();
          }}
          className={`p-1.5 rounded-[6px] transition-opacity bg-[var(--surface)]/95 border border-[var(--border)] ${
            copied
              ? 'opacity-100 text-[var(--success)]'
              : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
          title={copied ? t('copied') : t('copyUrl')}
          aria-label={t('copyUrl')}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {!isTrash && (
          <PinButton
            bookmarkId={bookmark.id}
            isPinned={!!bookmark.pinned}
            onTogglePin={onTogglePin}
            locale={locale}
            surface
          />
        )}
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextPoint(null);
            setShowMenu((v) => !v);
          }}
          aria-label="More actions"
          className={`p-1.5 rounded-[6px] transition-opacity bg-[var(--surface)]/95 border border-[var(--border)] ${
            showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          } text-[var(--text-muted)] hover:text-[var(--text)]`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cover Banner */}
      <div
        className={`w-full h-24 relative shrink-0 overflow-hidden border-b border-[var(--border)] ${
          hasCover ? 'bg-[var(--surface-2)]' : fallbackTint
        }`}
      >
        {hasCover ? (
          <img
            src={bookmark.coverUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center select-none">
            <span className="text-3xl font-bold tracking-tight opacity-25 uppercase">
              {(hostname || '?').charAt(0)}
            </span>
          </div>
        )}

        <div className="absolute top-2 left-2 flex items-center gap-1">
          {isBrokenLink(bookmark) && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--danger)] text-white">
              {t('brokenBadge')}
            </span>
          )}
          {relatedRoot && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--surface)]/95 text-[var(--accent)] border border-[var(--border)]"
              title={`${t('subPageOf')}: ${relatedTitle}\n${relatedRoot.url}`}
            >
              <CornerDownRight className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="flex flex-col flex-1 p-3 pt-2.5 gap-1.5 min-w-0">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-[var(--radius)] shrink-0 bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center overflow-hidden -mt-6 z-[1] ring-2 ring-[var(--surface)]">
            <img
              src={faviconUrl}
              alt=""
              loading="lazy"
              className="w-4 h-4"
              onError={(e) => {
                (e.target as HTMLImageElement).src = getFaviconFallback(bookmark.url);
              }}
            />
          </div>
          <h3
            className="text-[13px] font-semibold text-[var(--text)] line-clamp-2 leading-snug flex-1 min-w-0 m-0"
            title={bookmark.title || hostname}
          >
            <HighlightText text={bookmark.title || hostname} query={highlightQuery} />
          </h3>
        </div>

        {bookmark.note && (
          <p className="text-[12px] text-[var(--text-muted)] line-clamp-2 leading-relaxed m-0">
            {bookmark.note}
          </p>
        )}

        {visibleTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {visibleTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick?.(tag);
                }}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] hover:bg-[rgba(59,130,246,0.14)] hover:text-[var(--accent)] text-[10.5px] font-medium text-[var(--text-muted)] transition-colors"
              >
                <Hash className="w-2.5 h-2.5 opacity-60" />
                {tag}
              </button>
            ))}
            {extraTags > 0 && (
              <span className="text-[10.5px] text-[var(--text-muted)] font-medium">
                +{extraTags}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border)]">
          <span className="truncate min-w-0" title={bookmark.url}>
            {hostname}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {collectionName && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCollectionClick?.(bookmark.collectionId);
                }}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--surface-2)] hover:text-[var(--text)] text-[10px] font-medium text-[var(--text-muted)] max-w-[96px] transition-colors"
              >
                <Folder className="w-2.5 h-2.5 shrink-0 opacity-70" />
                <span className="truncate">{collectionName}</span>
              </button>
            )}
            <span className="tabular-nums">{relativeDate}</span>
          </div>
        </div>
      </div>

      {showMenu && (
        <ActionsMenu
          bookmark={bookmark}
          isTrash={isTrash}
          menuRef={menuRef}
          anchorRef={btnRef}
          anchorPoint={contextPoint}
          onEdit={onEdit}
          onDelete={onDelete}
          onRestore={onRestore}
          onTogglePin={onTogglePin}
          onCopyUrl={handleCopyUrl}
          onClose={closeMenu}
          locale={locale}
        />
      )}
    </div>
  );
}

export const BookmarkCard = memo(BookmarkCardInner);
