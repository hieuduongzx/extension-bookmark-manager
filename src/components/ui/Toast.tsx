import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ToastItem } from '../../hooks';

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="ui-toast-stack" aria-live="polite">
      {toasts.map((item) => {
        const variant = item.type ?? 'info';
        return (
          <div key={item.id} className={`ui-toast ui-toast--${variant} animate-slide-up`} role="status">
            {variant === 'success' && (
              <CheckCircle2 size={15} className="shrink-0" style={{ color: 'var(--success)' }} />
            )}
            {variant === 'error' && (
              <AlertCircle size={15} className="shrink-0" style={{ color: 'var(--danger)' }} />
            )}
            {variant === 'info' && (
              <Info size={15} className="shrink-0" style={{ color: 'var(--accent)' }} />
            )}
            <span className="min-w-0 truncate">{item.msg}</span>
            {item.action && (
              <button
                type="button"
                className="ui-toast-action"
                onClick={async () => {
                  const action = item.action;
                  if (!action) return;
                  onDismiss(item.id);
                  await action.onClick();
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
