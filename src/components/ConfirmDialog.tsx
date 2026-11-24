import { AlertTriangle, HelpCircle } from 'lucide-react';
import type { LocaleCode } from '../types';
import { createT } from '../i18n';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

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
  const isDanger = dialog.variant === 'danger';

  return (
    <Dialog
      open={true}
      role="alertdialog"
      title={dialog.title}
      onClose={onClose}
      closeLabel={t('close')}
      maxWidth={400}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            size="sm"
            autoFocus
            onClick={async () => {
              onClose();
              await dialog.onConfirm();
            }}
          >
            {dialog.confirmLabel || t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-[var(--radius)] shrink-0 flex items-center justify-center border ${
            isDanger
              ? 'bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.28)] text-[var(--danger)]'
              : 'bg-[rgba(59,130,246,0.1)] border-[rgba(59,130,246,0.28)] text-[var(--accent)]'
          }`}
        >
          {isDanger ? <AlertTriangle size={16} /> : <HelpCircle size={16} />}
        </div>
        <p className="m-0 text-[13px] leading-relaxed text-[var(--text-muted)]">{dialog.message}</p>
      </div>
    </Dialog>
  );
}
