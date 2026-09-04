import { memo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Edit, Trash2, ExternalLink, RefreshCw, CheckSquare, Square, Pin, GripVertical } from 'lucide-react';
import type { Bookmark } from '../types';
import { getDomain, getFavicon, getFaviconFallback, isBrokenLink } from '../utils';
import { useEscapeKey } from '../hooks';

export type ReorderPosition = 'before' | 'after';

interface BookmarkCardProps {
  bookmark: Bookmark;
  viewMode: 'grid' | 'list' | 'masonry';
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  isTrash?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string, selected: boolean) => void;
  onTogglePin?: (id: string) => void;
  isSelectMode?: boolean;
  onTagClick?: (tag: string) => void;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

// ─── Extracted Sub-Components ───────────────────────────────────────────────

interface ActionsMenuProps {
  bookmark: Bookmark;
  isTrash?: boolean;
  menuRef: React.RefObject<HTMLDivElement>;
  anchorRef: React.RefObject<HTMLButtonElement>;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string, isFromTrash: boolean) => void;
  onRestore: (id: string) => void;
  onClose: () => void;
}

function ActionsMenu({ bookmark, isTrash, menuRef, anchorRef, onEdit, onDelete, onRestore, onClose }: ActionsMenuProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEscapeKey(onClose);

  // Move focus into the menu once it's positioned, and return focus to the trigger on close.
  useEffect(() => {
    if (!pos) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    const anchor = anchorRef.current;
    return () => {
      if (anchor?.isConnected) anchor.focus();
    };
  }, [pos, menuRef, anchorRef]);

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
      const btn = anchorRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = 160;
      const menuHeight = 140;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Prefer below the button, aligned to its right edge
      let top = rect.bottom + 4;
      let left = rect.right - menuWidth;

      // Clamp horizontally
      if (left < margin) left = margin;
      if (left + menuWidth > vw - margin) left = vw - menuWidth - margin;

      // Flip above if not enough space below
      if (top + menuHeight > vh - margin) {
        top = rect.top - menuHeight - 4;
        if (top < margin) top = margin;
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
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Bookmark actions"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 160 }}
      className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-md overflow-hidden z-[1000] animate-slide-up focus:outline-none"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      <div className="p-1 flex flex-col">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-200 dark:hover:text-zinc-50 dark:hover:bg-zinc-700 dark:focus:bg-zinc-700 rounded cursor-pointer font-medium transition-colors focus:outline-none"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open Link
        </a>
        {!isTrash && (
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onEdit(bookmark);
            }}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-200 dark:hover:text-zinc-50 dark:hover:bg-zinc-700 dark:focus:bg-zinc-700 rounded cursor-pointer font-medium transition-colors w-full text-left focus:outline-none"
          >
            <Edit className="w-3.5 h-3.5" />
            Edit
          </button>
        )}
        {isTrash && (
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onRestore(bookmark.id);
            }}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-brand-600 hover:bg-brand-50 focus:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/50 dark:focus:bg-brand-950/50 rounded cursor-pointer font-medium transition-colors w-full text-left focus:outline-none"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Restore
          </button>
        )}
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-700 my-1 mx-1" />
        <button
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onDelete(bookmark.id, !!isTrash);
          }}
          className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:focus:bg-red-950/40 rounded cursor-pointer font-medium transition-colors w-full text-left focus:outline-none"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {isTrash ? 'Delete Forever' : 'Move to Trash'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface CheckboxToggleProps {
  bookmarkId: string;
  isSelected: boolean;
  onToggleSelect?: (id: string, selected: boolean) => void;
}

function CheckboxToggle({ bookmarkId, isSelected, onToggleSelect }: CheckboxToggleProps) {
  if (!onToggleSelect) return null;
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect(bookmarkId, !isSelected);
      }}
      className={`p-1 rounded-md transition-opacity bg-white dark:bg-zinc-800 opacity-100 ${
        isSelected
          ? 'text-brand-600 dark:text-brand-400'
          : 'text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400'
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
}

function PinButton({ bookmarkId, isPinned, onTogglePin }: PinButtonProps) {
  if (!onTogglePin) return null;
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTogglePin(bookmarkId);
      }}
      className={`p-1 rounded-md transition-opacity bg-white dark:bg-zinc-800 ${
        isPinned
          ? 'opacity-100 text-brand-600 dark:text-brand-400'
          : 'opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400'
      }`}
      title={isPinned ? "Unpin Bookmark" : "Pin Bookmark"}
    >
      <Pin className={`w-4 h-4 ${isPinned ? 'fill-current' : ''}`} />
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function BookmarkCardInner({
  bookmark,
  viewMode,
  onEdit,
  onDelete,
  onRestore,
  isTrash,
  isSelected = false,
  onToggleSelect,
  onTogglePin,
  isSelectMode = false,
  onTagClick: _onTagClick,
  compact = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
}: BookmarkCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropIndicator, setDropIndicator] = useState<'top' | 'bottom' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const hostname = getDomain(bookmark.url);
  const faviconUrl = bookmark.favicon || getFavicon(bookmark.url);

  const closeMenu = useCallback(() => setShowMenu(false), []);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if (
      btnRef.current?.contains(e.target as Node) ||
      menuRef.current?.contains(e.target as Node)
    ) {
      return;
    }
    window.open(bookmark.url, '_blank', 'noopener,noreferrer');
  }, [bookmark.url]);

  const handleToggleSelectWrapped = useCallback(() => {
    onToggleSelect?.(bookmark.id, !isSelected);
  }, [onToggleSelect, bookmark.id, isSelected]);

  if (viewMode === 'masonry') {
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/bookmark-id', bookmark.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={isSelectMode ? handleToggleSelectWrapped : handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            // Don't hijack Space/Enter that belongs to a focused inner control (pin/checkbox/menu).
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            (isSelectMode ? handleToggleSelectWrapped : () => window.open(bookmark.url, '_blank', 'noopener,noreferrer'))();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open ${bookmark.title || hostname}`}
        className={`group flex flex-col items-center justify-center gap-1.5 p-1.5 rounded-lg transition-colors duration-150 cursor-pointer relative focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900 ${
          isSelected
            ? 'bg-brand-50/70 dark:bg-brand-950/40'
            : 'hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50'
        }`}
        title={bookmark.title || hostname}
      >
        <div className="absolute top-0.5 right-0.5 z-10 flex flex-col gap-0.5 items-end">
          <CheckboxToggle bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={isSelectMode ? onToggleSelect : undefined} />
          <PinButton bookmarkId={bookmark.id} isPinned={!!bookmark.pinned} onTogglePin={onTogglePin} />
        </div>

        <div className="w-9 h-9 shrink-0 flex items-center justify-center overflow-hidden transition-transform duration-200 group-hover:scale-110">
          <img
            src={faviconUrl}
            alt=""
            loading="lazy"
            className="w-7 h-7"
            onError={(e) => {
              (e.target as HTMLImageElement).src = getFaviconFallback(bookmark.url);
            }}
          />
        </div>

        <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-100 line-clamp-2 text-center max-w-full px-0.5 leading-tight break-words">
          {bookmark.title || hostname}
        </span>

        <div className="absolute bottom-0.5 right-0.5 z-10">
          <button
            ref={btnRef}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className={`p-1 rounded-md transition-opacity ${
              showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            } ${
              isSelected
                ? 'text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300'
                : 'text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
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
            onEdit={onEdit}
            onDelete={onDelete}
            onRestore={onRestore}
            onClose={closeMenu}
          />
        )}
      </div>
    );
  }

  return viewMode === 'list' ? (
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
      onClick={isSelectMode ? handleToggleSelectWrapped : handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          (isSelectMode ? handleToggleSelectWrapped : () => window.open(bookmark.url, '_blank', 'noopener,noreferrer'))();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${bookmark.title || hostname}`}
      className={`group flex items-center gap-3 px-4 py-3 transition-all cursor-pointer relative focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900 ${
        isSelected
          ? 'bg-brand-50/70 border-brand-200 dark:bg-brand-950/40 dark:border-brand-900'
          : 'bg-white hover:bg-zinc-50/80 dark:bg-zinc-900 dark:hover:bg-zinc-800/60'
      } border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
      {dropIndicator === 'top' && (
        <span className="absolute -top-px left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none" />
      )}
      {dropIndicator === 'bottom' && (
        <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none" />
      )}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {draggable && !isSelectMode && (
          <div
            className="text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <CheckboxToggle bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={isSelectMode ? onToggleSelect : undefined} />

        {/* Favicon */}
        <div className="w-9 h-9 rounded-lg shrink-0 bg-zinc-50 border border-zinc-200/80 dark:bg-zinc-800 dark:border-zinc-700 flex items-center justify-center overflow-hidden">
          <img
            src={faviconUrl}
            alt=""
            loading="lazy"
            className="w-5 h-5"
            onError={(e) => {
              (e.target as HTMLImageElement).src = getFaviconFallback(bookmark.url);
            }}
          />
        </div>

        {/* Title, URL, and Note */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
          <div className="flex items-center gap-3">
            <h3
              className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50 truncate max-w-[260px] shrink-0"
              title={bookmark.title || hostname}
            >
              {bookmark.title || hostname}
            </h3>
            {isBrokenLink(bookmark) && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300">
                Broken
              </span>
            )}
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 truncate flex-1 min-w-0" title={bookmark.url}>
              {hostname}
            </p>
          </div>
          {!compact && bookmark.note && (
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 truncate italic">{bookmark.note}</p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="shrink-0 flex items-center gap-0.5">
        <PinButton bookmarkId={bookmark.id} isPinned={!!bookmark.pinned} onTogglePin={onTogglePin} />
        <button
          ref={btnRef}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${
            isSelected
              ? 'text-brand-600 hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-900/50'
              : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800'
          }`}
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
          onEdit={onEdit}
          onDelete={onDelete}
          onRestore={onRestore}
          onClose={closeMenu}
        />
      )}
    </div>
  ) : (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/bookmark-id', bookmark.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={isSelectMode ? handleToggleSelectWrapped : handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          (isSelectMode ? handleToggleSelectWrapped : () => window.open(bookmark.url, '_blank', 'noopener,noreferrer'))();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${bookmark.title || hostname}`}
      className={`group flex flex-col h-[112px] rounded-xl border transition-all duration-200 cursor-pointer relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 ${
        isSelected
          ? 'bg-brand-50/50 border-brand-300 shadow-md ring-1 ring-brand-200 dark:bg-brand-950/30 dark:border-brand-700 dark:ring-brand-800'
          : 'bg-white border-zinc-200/80 hover:border-zinc-300 hover:shadow-md hover:-translate-y-0.5 dark:bg-zinc-900 dark:border-zinc-700/80 dark:hover:border-zinc-600'
      }`}
    >
      <div className="absolute top-1.5 right-1.5 z-10 flex flex-col gap-0.5 items-end">
        <CheckboxToggle bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={isSelectMode ? onToggleSelect : undefined} />
        <PinButton bookmarkId={bookmark.id} isPinned={!!bookmark.pinned} onTogglePin={onTogglePin} />
        <button
          ref={btnRef}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className={`p-1 rounded-md transition-opacity bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm border border-zinc-200/60 dark:border-zinc-700/60 shadow-sm ${
            showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          } ${
            isSelected
              ? 'text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300'
              : 'text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200'
          }`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cover banner — same reserved height for all cards so with/without image stay equal */}
      <div className="w-full h-14 bg-zinc-100 dark:bg-zinc-800 relative shrink-0 overflow-hidden">
        {bookmark.coverUrl ? (
          <img
            src={bookmark.coverUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2.5 flex-1 min-h-0 px-3 py-2">
        {/* Favicon — always separate from cover */}
        <div className="w-8 h-8 rounded-lg shrink-0 bg-zinc-50 border border-zinc-200/80 dark:bg-zinc-800 dark:border-zinc-700 flex items-center justify-center overflow-hidden -mt-5 z-[1] ring-2 ring-white dark:ring-zinc-900">
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

        <div className="flex-1 min-w-0 pr-6">
          <h3
            className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50 truncate leading-tight"
            title={bookmark.title || hostname}
          >
            {bookmark.title || hostname}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate" title={bookmark.url}>
              {hostname}
            </p>
            {isBrokenLink(bookmark) && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300">
                Broken
              </span>
            )}
          </div>
        </div>
      </div>

      {showMenu && (
        <ActionsMenu
          bookmark={bookmark}
          isTrash={isTrash}
          menuRef={menuRef}
          anchorRef={btnRef}
          onEdit={onEdit}
          onDelete={onDelete}
          onRestore={onRestore}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

export const BookmarkCard = memo(BookmarkCardInner);
