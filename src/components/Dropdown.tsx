import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Optional left adornment (icon, badge, color swatch). */
  leading?: ReactNode;
  /** Indentation level for hierarchical items (e.g. nested collections). */
  depth?: number;
  /** Render this option as disabled. */
  disabled?: boolean;
}

interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Override for the displayed button label (defaults to selected option label). */
  buttonLabel?: ReactNode;
  /** Optional leading slot for the button (icon next to selected label). */
  buttonLeading?: ReactNode;
  /** Compact (h-8 / 32px) for dense toolbars; md is 34px. */
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Max menu height in px (default 256). */
  menuMaxHeight?: number;
  /** Sticky action at bottom of the menu (e.g. “New collection”). */
  footerAction?: {
    label: string;
    onClick: () => void;
    leading?: ReactNode;
  };
}

/**
 * *2k standard dropdown — synced with TubeDeck2k design tokens.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  buttonLabel,
  buttonLeading,
  size = 'md',
  className = '',
  ariaLabel,
  disabled = false,
  placeholder = 'Select…',
  menuMaxHeight = 256,
  footerAction,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUp(spaceBelow < menuMaxHeight + 16 && spaceAbove > spaceBelow);
  }, [open, menuMaxHeight]);

  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])');
    if (!items || items.length === 0) return;
    const selectedIdx = options.findIndex((o) => o.value === value && !o.disabled);
    (items[selectedIdx >= 0 ? selectedIdx : 0] ?? items[0]).focus();
  }, [open, options, value]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])') ?? []
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

  const heightClass = size === 'sm' ? 'h-8' : 'h-[34px]';
  const paddingClass = size === 'sm' ? 'px-2.5' : 'px-3';

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`group w-full flex items-center justify-between gap-2 ${paddingClass} ${heightClass}
          rounded-[var(--radius)] border bg-[var(--surface)] text-left transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(59,130,246,0.22)]
          ${
            open
              ? 'border-[var(--accent)] ring-2 ring-[rgba(59,130,246,0.18)]'
              : 'border-[var(--border)] hover:bg-[var(--surface-2)]'
          }`}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          {buttonLeading}
          {current?.leading && !buttonLeading ? current.leading : null}
          <span className="text-[12.5px] font-medium text-[var(--text)] truncate whitespace-nowrap">
            {buttonLabel ?? current?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${
            open ? 'rotate-180 text-[var(--text)]' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          onKeyDown={onListKeyDown}
          className={`absolute left-0 right-0 z-30 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-pop overflow-hidden animate-slide-up ${
            openUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div
            ref={listRef}
            className="p-1 flex flex-col overflow-auto custom-scrollbar"
            style={{ maxHeight: menuMaxHeight }}
          >
            {options.map((option) => {
              const selected = option.value === value;
              const indent = (option.depth ?? 0) * 12;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={{ paddingLeft: 8 + indent }}
                  className={`flex items-start gap-2 pr-2 py-1.5 rounded-[6px] text-left transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? 'bg-[rgba(59,130,246,0.14)] text-[var(--accent)]'
                        : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                >
                  <Check
                    className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                      selected ? 'text-[var(--accent)]' : 'text-transparent'
                    }`}
                  />
                  {option.leading && <span className="mt-0.5 shrink-0">{option.leading}</span>}
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="text-[12.5px] font-medium truncate">{option.label}</span>
                    {option.description && (
                      <span className="text-[11px] leading-snug truncate text-[var(--text-muted)]">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {footerAction && (
            <div className="border-t border-[var(--border)] p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  footerAction.onClick();
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-left text-[var(--accent)] hover:bg-[rgba(59,130,246,0.1)] transition-colors"
              >
                {footerAction.leading && <span className="shrink-0">{footerAction.leading}</span>}
                <span className="text-[12.5px] font-medium truncate">{footerAction.label}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
