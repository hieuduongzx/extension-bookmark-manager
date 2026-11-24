import { useEffect } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { useEscapeKey, useFocusTrap } from '../hooks';
import type { LocaleCode } from '../types';
import { createT } from '../i18n';

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogState;
  locale: LocaleCode;
  onClose: () => void;
}

export function ConfirmDialog({ dialog, locale, onClose }: ConfirmDialogProps) {
  const t = createT(locale);
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose);

  useEffect(() => {
    containerRef.current?.focus();
  }, [containerRef]);

  const isDanger = dialog.variant === 'danger';

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-zinc-900/45 dark:bg-black/65 backdrop-blur-[2px]"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-pop overflow-hidden animate-scale-in focus:outline-none"
      >
        <div className="p-5 flex gap-3.5 items-start">
          <div
            className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center border ${
              isDanger
                ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400'
                : 'bg-brand-50 border-brand-200 text-brand-600 dark:bg-brand-950/40 dark:border-brand-900 dark:text-brand-400'
            }`}
          >
            {isDanger ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <HelpCircle className="w-4 h-4" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h2
                id="confirm-dialog-title"
                className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50 leading-snug"
              >
                {dialog.title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="btn-icon-sm -mt-1 -mr-1"
                aria-label={t('close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p
              id="confirm-dialog-desc"
              className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300"
            >
              {dialog.message}
            </p>
          </div>
        </div>
        <div className="px-5 py-3.5 bg-zinc-50/70 dark:bg-zinc-800/40 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost-sm px-3.5">
            {t('cancel')}
          </button>
          <button
            type="button"
            autoFocus
            onClick={async () => {
              onClose();
              await dialog.onConfirm();
            }}
            className={
              isDanger
                ? 'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[13px] font-medium bg-red-600 hover:bg-red-700 text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-colors'
                : 'btn-brand-sm px-3.5'
            }
          >
            {dialog.confirmLabel || t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
