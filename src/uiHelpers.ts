import type { GDriveUiStatus } from './driveSync';

export type DriveDotTone = 'is-synced' | 'is-syncing' | 'is-warn' | 'is-error' | 'is-muted';

export function resolveDriveDotTone(gdrive: GDriveUiStatus | null | undefined): DriveDotTone {
  if (!gdrive) return 'is-muted';
  if (gdrive.busy || gdrive.status === 'syncing') return 'is-syncing';
  if (gdrive.needsReauth || gdrive.status === 'needs_reauth') return 'is-warn';
  if (gdrive.status === 'error') return 'is-error';
  if (gdrive.connected) return 'is-synced';
  return 'is-muted';
}
