import type React from 'react';
import { X } from 'lucide-react';
import { useEscapeKey, useFocusTrap } from '../../hooks';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  maxWidth?: number;
  closeLabel?: string;
  role?: 'dialog' | 'alertdialog';
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  headerActions,
  maxWidth = 460,
  closeLabel = 'Close',
  role = 'dialog',
}: DialogProps) {
  const containerRef = useFocusTrap<HTMLDivElement>(open);
  useEscapeKey(onClose, open);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      role={role}
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="ui-dialog animate-scale-in"
        style={{ maxWidth }}
      >
        <div className="ui-dialog-header">
          <h3 className="ui-dialog-title">{title}</h3>
          <div className="flex items-center gap-1">
            {headerActions}
            <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label={closeLabel}>
              <X size={16} />
            </Button>
          </div>
        </div>
        <div className="ui-dialog-body custom-scrollbar">{children}</div>
        {footer && <div className="ui-dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
