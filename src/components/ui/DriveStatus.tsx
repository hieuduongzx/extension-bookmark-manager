import { AlertTriangle } from 'lucide-react';
import type { GDriveUiStatus } from '../../driveSync';
import { resolveDriveDotTone } from '../../uiHelpers';

export { resolveDriveDotTone, type DriveDotTone } from '../../uiHelpers';

interface DriveStatusDotProps {
  gdrive?: GDriveUiStatus | null;
  title: string;
  onClick?: () => void;
}

export function DriveStatusDot({ gdrive, title, onClick }: DriveStatusDotProps) {
  const tone = resolveDriveDotTone(gdrive);
  return (
    <button
      type="button"
      className={`ui-drive-dot ${tone}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    />
  );
}

interface ReauthBannerProps {
  message: string;
  actionLabel: string;
  busy?: boolean;
  onAction: () => void;
}

export function ReauthBanner({ message, actionLabel, busy = false, onAction }: ReauthBannerProps) {
  return (
    <div className="ui-reauth-banner" role="alert">
      <AlertTriangle size={14} className="ui-reauth-ic" />
      <span className="ui-reauth-text">{message}</span>
      <button type="button" className="ui-reauth-btn" onClick={onAction} disabled={busy}>
        {actionLabel}
      </button>
    </div>
  );
}
