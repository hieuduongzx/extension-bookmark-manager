import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

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
  /** Compact (h-8) for dense toolbars; default is h-9. */
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Max menu height in px (default 256). */
  menuMaxHeight?: number;
}

/**
 * Lab Studio standard dropdown — light theme.
 * Same vocabulary as web-translator: brand ring on open, brand-50 on selected,
 * Check icon as selection mark, optional description line, slide-up panel.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  buttonLabel,
  buttonLeading,
  size = "md",
  className = "",
  ariaLabel,
  disabled = false,
  placeholder = "Select…",
  menuMaxHeight = 256,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const heightClass = size === "sm" ? "h-8" : "h-9";
  const paddingClass = size === "sm" ? "px-2.5" : "px-3";

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`group w-full flex items-center justify-between gap-2 ${paddingClass} ${heightClass}
          rounded-md border bg-white text-left transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          focus:outline-none focus:ring-2 focus:ring-brand-500/20
          ${
            open
              ? "border-brand-300 ring-1 ring-brand-200"
              : "border-zinc-200 hover:border-zinc-300"
          }`}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          {buttonLeading}
          {current?.leading && !buttonLeading ? current.leading : null}
          <span className="text-[13px] font-semibold tracking-tight text-zinc-900 truncate">
            {buttonLabel ?? current?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-zinc-400 transition-transform ${
            open ? "rotate-180 text-zinc-700" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-zinc-200 rounded-md shadow-lg overflow-hidden animate-slide-up"
        >
          <div
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
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={{ paddingLeft: 8 + indent }}
                  className={`flex items-start gap-2 pr-2 py-1.5 rounded text-left transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? "bg-brand-50 text-brand-900"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                >
                  <Check
                    className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                      selected ? "text-brand-600" : "text-transparent"
                    }`}
                  />
                  {option.leading && <span className="mt-0.5 shrink-0">{option.leading}</span>}
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="text-[12.5px] font-semibold tracking-tight truncate">
                      {option.label}
                    </span>
                    {option.description && (
                      <span
                        className={`text-[10.5px] leading-snug truncate ${
                          selected ? "text-brand-700/80" : "text-zinc-500"
                        }`}
                      >
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
