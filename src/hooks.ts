import { useEffect, useRef, useState, useCallback } from 'react';

// ─── useEscapeKey ─────────────────────────────────────────────────────────────
// Closes modals/menus when user presses Escape. Use in any dismissible UI.
//
// A single document-level listener drives a LIFO stack of registered handlers, so only
// the top-most (most recently opened) layer responds to one Escape press. This avoids the
// old bug where every open layer's handler fired at once (stopPropagation on a shared
// document listener doesn't stop sibling listeners on the same target).

type EscapeHandler = () => void;
const escapeStack: EscapeHandler[] = [];
let globalEscapeListenerInstalled = false;

function ensureGlobalEscapeListener() {
  if (globalEscapeListenerInstalled || typeof document === 'undefined') return;
  globalEscapeListenerInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = escapeStack[escapeStack.length - 1];
    if (top) {
      e.stopPropagation();
      top();
    }
  });
}

export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    ensureGlobalEscapeListener();
    const entry: EscapeHandler = () => handlerRef.current();
    escapeStack.push(entry);
    return () => {
      const i = escapeStack.lastIndexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [enabled]);
}

// ─── useFocusTrap ─────────────────────────────────────────────────────────────
// Traps Tab/Shift+Tab focus within a container. Returns ref to attach to dialog.

export function useFocusTrap<T extends HTMLElement>(active = true) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previousActive = document.activeElement as HTMLElement | null;

    const getFocusable = () => {
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handler);
    return () => {
      container.removeEventListener('keydown', handler);
      previousActive?.focus?.();
    };
  }, [active]);

  return containerRef;
}

// ─── useDebouncedValue ────────────────────────────────────────────────────────
// Debounce a fast-changing value. Useful for search input.

export function useDebouncedValue<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

// ─── useToastQueue ────────────────────────────────────────────────────────────
// Queue-based toast manager. Default 2.5s; toasts with actions get 5s.

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastItem {
  id: number;
  msg: string;
  action?: ToastAction;
}

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (msg: string, action?: ToastAction) => {
      counterRef.current += 1;
      const id = counterRef.current;
      setToasts((prev) => [...prev, { id, msg, action }]);

      const duration = action ? 5000 : 2500;
      const timer = window.setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
      timersRef.current.set(id, timer);
    },
    []
  );

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer]
  );

  // Clear any pending dismissal timers on unmount so they don't fire into an
  // unmounted component.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, show, dismiss };
}
