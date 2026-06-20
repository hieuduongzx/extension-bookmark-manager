import { memo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Edit, Trash2, ExternalLink, RefreshCw, CheckSquare, Square, Pin, StickyNote, GripVertical } from 'lucide-react';
import type { Bookmark } from '../types';
import { getDomain, getFavicon, getFaviconFallback } from '../utils';

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
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 160 }}
      className="bg-white border border-zinc-200 shadow-xl rounded-md overflow-hidden z-[1000] animate-slide-up"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-1 flex flex-col">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 rounded cursor-pointer font-medium transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open Link
        </a>
        {!isTrash && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onEdit(bookmark);
            }}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 rounded cursor-pointer font-medium transition-colors w-full text-left"
          >
            <Edit className="w-3.5 h-3.5" />
            Edit
          </button>
        )}
        {isTrash && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onRestore(bookmark.id);
            }}
            className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-brand-600 hover:bg-brand-50 rounded cursor-pointer font-medium transition-colors w-full text-left"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Restore
          </button>
        )}
        <div className="h-[1px] bg-zinc-100 my-1 mx-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onDelete(bookmark.id, !!isTrash);
          }}
          className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-red-600 hover:bg-red-50 rounded cursor-pointer font-medium transition-colors w-full text-left"
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
      className={`p-1 rounded-md transition-opacity bg-white opacity-100 ${
        isSelected ? 'text-brand-600' : 'text-zinc-300 hover:text-zinc-500'
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
      className={`p-1 rounded-md transition-opacity bg-white ${
        isPinned ? 'opacity-100 text-brand-600' : 'opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-zinc-500'
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
  onTagClick,
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
        }}
        onClick={isSelectMode ? handleToggleSelectWrapped : handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            (isSelectMode ? handleToggleSelectWrapped : () => window.open(bookmark.url, '_blank', 'noopener,noreferrer'))();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open ${bookmark.title || hostname}`}
        className={`group flex flex-col items-center justify-center aspect-square p-2 rounded-2xl border shadow-sm transition-all cursor-pointer relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
          isSelected ? 'bg-brand-50/50 border-brand-200 shadow-md' : 'bg-white border-zinc-200 hover:shadow-md hover:border-zinc-300'
        }`}
        title={bookmark.title || hostname}
      >
        <div className="absolute top-1 right-1 z-10 flex flex-col gap-1 items-end drop-shadow-sm scale-75 origin-top-right">
          <CheckboxToggle bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={isSelectMode ? onToggleSelect : undefined} />
          <PinButton bookmarkId={bookmark.id} isPinned={!!bookmark.pinned} onTogglePin={onTogglePin} />
        </div>

        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl shrink-0 bg-white border border-zinc-100 flex items-center justify-center overflow-hidden shadow-sm transition-transform group-hover:scale-105">
          <img
            src={faviconUrl}
            alt=""
            loading="lazy"
            className="w-5 h-5 sm:w-6 sm:h-6"
            onError={(e) => {
              (e.target as HTMLImageElement).src = getFaviconFallback(bookmark.url);
            }}
          />
        </div>

        <span className="mt-1.5 text-[10px] text-zinc-500 truncate max-w-full px-1 leading-tight">
          {hostname}
        </span>

        <div className="absolute bottom-1 right-1 z-10 scale-75 origin-bottom-right">
          <button
            ref={btnRef}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className={`p-1 rounded-md transition-opacity bg-white/80 backdrop-blur-sm border border-zinc-100 shadow-sm ${
              showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            } ${
              isSelected ? 'text-brand-600 hover:text-brand-800' : 'text-zinc-500 hover:text-zinc-900'
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
      className={`group flex items-center justify-between p-3 rounded-lg border shadow-sm transition-all cursor-pointer relative focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
        isSelected ? 'bg-brand-50/50 border-brand-200 shadow-md' : 'bg-white border-zinc-200 hover:shadow-md hover:border-zinc-300'
      } ${isDragging ? 'opacity-40 scale-[0.98]' : 'opacity-100'}`}
    >
      {dropIndicator === 'top' && (
        <span className="absolute -top-1 left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none" />
      )}
      {dropIndicator === 'bottom' && (
        <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none" />
      )}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {draggable && !isSelectMode && (
          <div
            className="text-zinc-300 hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <CheckboxToggle bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={isSelectMode ? onToggleSelect : undefined} />

        {/* Favicon */}
        <div className="w-8 h-8 rounded shrink-0 bg-white border border-zinc-100 flex items-center justify-center overflow-hidden shadow-sm">
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

        {/* Title, URL, and Note */}
        <div className="flex-1 min-w-0 flex flex-col justify-center py-0.5">
          <div className="flex flex-row items-center gap-4">
            <h3
              className="text-[13px] font-semibold text-zinc-900 truncate tracking-tight w-[35%] min-w-[150px] shrink-0"
              title={bookmark.title || hostname}
            >
              {bookmark.title || hostname}
            </h3>
            <p className={`text-[12px] truncate flex-1 min-w-0 ${isSelected ? 'text-brand-600/70' : 'text-zinc-500'}`} title={bookmark.url}>
              {bookmark.url}
            </p>
          </div>
          {!compact && bookmark.note && (
            <div className="mt-1 flex items-start gap-1.5 text-zinc-600 bg-zinc-50/80 border border-zinc-200/60 rounded p-1.5 w-fit max-w-full">
              <StickyNote className="w-3 h-3 shrink-0 mt-0.5 text-zinc-400" />
              <p className="text-[11px] leading-snug truncate italic">{bookmark.note}</p>
            </div>
          )}
        </div>

        {/* Tags */}
        {!compact && (
          <div className="hidden sm:flex items-center gap-1.5 overflow-hidden shrink-0 w-32 justify-end">
            {bookmark.tags.slice(0, 2).map((tag) => (
              <button
                key={tag}
                onClick={(e) => {
                  if (onTagClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    onTagClick(tag);
                  }
                }}
                className={`px-1.5 py-0.5 rounded border text-[10px] uppercase font-semibold tracking-wider whitespace-nowrap transition-colors ${
                  onTagClick ? 'cursor-pointer hover:border-zinc-300 hover:bg-zinc-200' : ''
                } ${
                  isSelected ? 'bg-brand-100/50 border-brand-200 text-brand-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600'
                }`}
              >
                {tag}
              </button>
            ))}
            {bookmark.tags.length > 2 && (
              <span className="text-[10px] text-zinc-500 font-medium">+{bookmark.tags.length - 2}</span>
            )}
          </div>
        )}


      </div>

      {/* Action Buttons */}
      <div className="shrink-0 flex items-center gap-1 ml-2">
        <PinButton bookmarkId={bookmark.id} isPinned={!!bookmark.pinned} onTogglePin={onTogglePin} />
        <button
          ref={btnRef}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className={`p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${
            isSelected ? 'text-brand-600 hover:bg-brand-100' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'
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
      className={`group flex flex-col rounded-lg border shadow-sm transition-all cursor-pointer relative overflow-hidden min-h-[140px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
        isSelected ? 'bg-brand-50/50 border-brand-200 shadow-md' : 'bg-white border-zinc-200 hover:shadow-md hover:border-zinc-300'
      }`}
    >
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end drop-shadow-sm">
        <CheckboxToggle bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={isSelectMode ? onToggleSelect : undefined} />
        <PinButton bookmarkId={bookmark.id} isPinned={!!bookmark.pinned} onTogglePin={onTogglePin} />
        <button
          ref={btnRef}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className={`p-1 rounded-md transition-opacity bg-white ${
            showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          } ${
            isSelected ? 'text-brand-600 hover:text-brand-800' : 'text-zinc-400 hover:text-zinc-900'
          }`}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Cover Image */}
      {bookmark.coverUrl && (
        <div className="w-full h-32 bg-zinc-100 relative shrink-0">
          <img
            src={bookmark.coverUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
        </div>
      )}

      <div className="flex flex-col flex-1 p-3">
        <div className="flex items-start gap-3 w-full mb-3">
          {/* Favicon */}
          <div className={`w-8 h-8 rounded shrink-0 bg-white border border-zinc-100 flex items-center justify-center overflow-hidden shadow-sm ${bookmark.coverUrl ? '-mt-6 z-10' : 'mt-0.5'}`}>
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

          {/* Content */}
          <div className="flex-1 min-w-0 pr-8">
            <h3
              className="text-[13px] font-semibold text-zinc-900 line-clamp-2 tracking-tight mb-0.5 leading-snug"
              title={bookmark.title}
            >
              {bookmark.title || hostname}
            </h3>
            <div className="flex items-center gap-1.5 text-[12px] min-w-0">
              <p className={`truncate ${isSelected ? 'text-brand-600/70' : 'text-zinc-500'}`} title={bookmark.url}>
                {hostname}
              </p>
            </div>
          </div>
        </div>

        {bookmark.note && (
          <div className="mb-3 flex items-start gap-1.5 text-zinc-600 bg-zinc-50/80 border border-zinc-200/60 rounded-md p-2 w-full shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5 text-zinc-400" />
            <p className="text-[11px] leading-relaxed line-clamp-2 italic">{bookmark.note}</p>
          </div>
        )}

        {/* Footer / Tags */}
        <div className="relative mt-auto flex items-center justify-between pointer-events-none p-3 pt-0">
          <div className="flex items-center gap-1.5 overflow-hidden">
            {bookmark.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                onClick={(e) => {
                  if (onTagClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    onTagClick(tag);
                  }
                }}
                className={`px-1.5 py-0.5 rounded border text-[10px] uppercase font-semibold tracking-wider whitespace-nowrap pointer-events-auto transition-colors ${
                  onTagClick ? 'cursor-pointer hover:border-zinc-300 hover:bg-zinc-200' : ''
                } ${
                  isSelected ? 'bg-brand-100/50 border-brand-200 text-brand-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600'
                }`}
              >
                {tag}
              </button>
            ))}
            {bookmark.tags.length > 3 && (
              <span className="text-[10px] text-zinc-500 font-medium">+{bookmark.tags.length - 3}</span>
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
