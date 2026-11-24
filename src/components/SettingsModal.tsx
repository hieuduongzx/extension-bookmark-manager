import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileCode2,
  Keyboard,
  Link2Off,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppSettings,
  Collection,
  LocaleCode,
  Message,
  SortOrder,
  ThemeMode,
  ViewMode,
} from '../types';
import { COLLECTION } from '../types';
import { createT } from '../i18n';
import { Dropdown } from './Dropdown';
import type { DriveBackup, GDriveStatus } from '../driveSync';
import {
  formatAbsoluteTime,
  formatDriveError,
  formatRelativeTime,
} from '../shared/driveSync/strings';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Switch } from './ui/Switch';

export interface LibraryStats {
  totalBookmarks: number;
  totalCollections: number;
  totalTags: number;
  pinnedCount: number;
  brokenCount: number;
}

interface SettingsModalProps {
  settings: AppSettings;
  collections: Collection[];
  stats?: LibraryStats;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
  onCheckBroken?: () => void;
  onEmptyOldTrash?: () => void;
  onRefreshPreviews?: () => void;
  onImportJson?: () => void;
  onImportHtml?: () => void;
  onImportBrowser?: () => void;
  onExport?: () => void;
  onExportHtml?: () => void;
  onGDriveStateChange?: () => void;
  onToast?: (msg: string) => void;
  autoConnectGDrive?: boolean;
}

type TabId = 'general' | 'sync' | 'data' | 'shortcuts';

export function SettingsModal({
  settings,
  collections,
  stats,
  onSave,
  onClose,
  onCheckBroken,
  onEmptyOldTrash,
  onRefreshPreviews,
  onImportJson,
  onImportHtml,
  onImportBrowser,
  onExport,
  onExportHtml,
  onGDriveStateChange,
  onToast,
  autoConnectGDrive = false,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const t = useMemo(() => createT(draft.locale), [draft.locale]);
  const [trashDaysInput, setTrashDaysInput] = useState(String(settings.trashAutoEmptyDays));
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(autoConnectGDrive ? 'sync' : 'general');
  const [gdrive, setGdrive] = useState<GDriveStatus | null>(null);
  const [gdriveBusy, setGdriveBusy] = useState<
    'connect' | 'sync' | 'disconnect' | 'delete' | 'backup' | null
  >(null);
  const [gdriveError, setGdriveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, setClock] = useState(0);

  const collectionOptions = useMemo(
    () => [
      { value: COLLECTION.UNSORTED, label: t('unsorted') },
      ...collections.map((c) => ({ value: c.id, label: c.name })),
    ],
    [collections, t]
  );

  const refreshGDrive = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'BM:gdriveStatus' } satisfies Message, (response) => {
      if (chrome.runtime.lastError) {
        setGdriveError(chrome.runtime.lastError.message ?? 'Unknown error');
        return;
      }
      if (response?.error) {
        setGdriveError(String(response.error));
        return;
      }
      setGdrive(response as GDriveStatus);
      setGdriveError(null);
    });
  }, []);

  useEffect(() => {
    refreshGDrive();
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.bm_drive_state) refreshGDrive();
    };
    chrome.storage.onChanged.addListener(onChanged);
    const timer = window.setInterval(() => setClock((n) => n + 1), 30_000);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      window.clearInterval(timer);
    };
  }, [refreshGDrive]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const sendGDrive = (
    msg: Message
  ): Promise<{ error?: string; gdrive?: GDriveStatus; backup?: DriveBackup | null }> =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response ?? {});
      });
    });

  const runGDrive = async (
    kind: 'connect' | 'sync' | 'disconnect' | 'delete',
    msg: Message,
    successToast: string
  ) => {
    setGdriveBusy(kind);
    setGdriveError(null);
    try {
      const res = await sendGDrive(msg);
      if (res.gdrive) setGdrive(res.gdrive);
      else refreshGDrive();
      if (res.error) {
        onToast?.(res.error.split('\n')[0] || t('gdriveSyncFailed'));
      } else {
        onToast?.(successToast);
        onGDriveStateChange?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGdriveError(message);
      onToast?.(message.split('\n')[0] || t('gdriveSyncFailed'));
    } finally {
      setGdriveBusy(null);
    }
  };

  const handleConnect = async () => {
    const isPopup = !window.location.search.includes('target=dashboard');
    if (isPopup) {
      const url = chrome.runtime.getURL('index.html?target=dashboard&gdrive=connect');
      await chrome.tabs.create({ url });
      onClose();
      return;
    }
    await runGDrive('connect', { type: 'BM:gdriveConnect' }, t('gdriveConnectSuccess'));
  };

  const handleSync = () => runGDrive('sync', { type: 'BM:gdriveSync' }, t('gdriveSyncSuccess'));
  const handleDisconnect = () =>
    runGDrive('disconnect', { type: 'BM:gdriveDisconnect' }, t('gdriveDisconnected'));
  const handleDeleteRemote = () =>
    runGDrive('delete', { type: 'BM:gdriveDeleteRemote' }, t('gdriveDeleteRemoteDone'));

  const handleDownloadBackup = async () => {
    setGdriveBusy('backup');
    let url: string | null = null;
    try {
      const res = await sendGDrive({ type: 'BM:gdriveGetBackup' });
      if (!res.backup) {
        onToast?.(t('gdriveBackupNone'));
        return;
      }
      const blob = new Blob([JSON.stringify(res.backup, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookmark-manager-drive-backup-${new Date(res.backup.savedAt)
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : String(err));
    } finally {
      if (url) URL.revokeObjectURL(url);
      setGdriveBusy(null);
    }
  };

  const driveLocale = draft.locale === 'vi' ? 'vi' : 'en';
  const driveErr =
    gdrive?.lastError && (gdrive.status === 'error' || gdrive.status === 'needs_reauth')
      ? formatDriveError(gdrive.lastError, driveLocale, {
          redirectUri: gdrive.redirectUri,
          extensionId: gdrive.extensionId,
        })
      : null;

  const statusChip = (() => {
    if (!gdrive?.connected) return null;
    if (gdrive.syncing || gdriveBusy === 'sync' || gdriveBusy === 'connect') {
      return {
        label: t('gdriveSyncing'),
        color: 'var(--accent)',
        bg: 'rgba(59, 130, 246, 0.14)',
      };
    }
    switch (gdrive.status) {
      case 'needs_reauth':
        return {
          label: t('gdriveStatusNeedsReauth'),
          color: 'var(--warning)',
          bg: 'rgba(245, 158, 11, 0.14)',
        };
      case 'error':
        return {
          label: t('gdriveStatusError'),
          color: 'var(--danger)',
          bg: 'rgba(239, 68, 68, 0.14)',
        };
      case 'synced':
        return {
          label: t('gdriveStatusSynced'),
          color: 'var(--success)',
          bg: 'rgba(34, 197, 94, 0.14)',
        };
      default:
        return {
          label: t('gdriveStatusIdle'),
          color: 'var(--text-muted)',
          bg: 'var(--surface-2)',
        };
    }
  })();

  const busy = gdriveBusy !== null;

  const tabs: { id: TabId; icon: React.ElementType; label: string }[] = [
    { id: 'general', icon: SlidersHorizontal, label: t('tabGeneral') },
    { id: 'sync', icon: Cloud, label: t('tabSync') },
    { id: 'data', icon: Database, label: t('tabData') },
    { id: 'shortcuts', icon: Keyboard, label: t('tabShortcuts') },
  ];

  return (
    <>
      <Dialog
        open={true}
        title={t('settings')}
        onClose={onClose}
        closeLabel={t('close')}
        maxWidth={540}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="primary" size="sm" disabled={saving} onClick={handleSave}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Segmented Tab Bar (*2k standard) */}
          <div
            role="tablist"
            aria-label={t('settings')}
            className="ui-segmented w-full grid grid-cols-4"
          >
            {tabs.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`ui-segmented-btn !h-[30px] ${activeTab === id ? 'is-active' : ''}`}
              >
                <Icon size={13} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {activeTab === 'general' && (
            <section className="space-y-3" aria-label={t('tabGeneral')}>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="ui-label">{t('theme')}</span>
                  <Dropdown<ThemeMode>
                    size="sm"
                    value={draft.theme}
                    onChange={(theme) => setDraft((d) => ({ ...d, theme }))}
                    options={[
                      { value: 'light', label: t('themeLight') },
                      { value: 'dark', label: t('themeDark') },
                      { value: 'system', label: t('themeSystem') },
                    ]}
                    ariaLabel={t('theme')}
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <span className="ui-label">{t('language')}</span>
                  <Dropdown<LocaleCode>
                    size="sm"
                    value={draft.locale}
                    onChange={(locale) => setDraft((d) => ({ ...d, locale }))}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'vi', label: 'Tiếng Việt' },
                    ]}
                    ariaLabel={t('language')}
                    className="w-full"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="ui-label">{t('defaultViewMode')}</span>
                  <Dropdown<ViewMode>
                    size="sm"
                    value={draft.defaultViewMode}
                    onChange={(defaultViewMode) => setDraft((d) => ({ ...d, defaultViewMode }))}
                    options={[
                      { value: 'list', label: t('viewList') },
                      { value: 'grid', label: t('viewGrid') },
                      { value: 'masonry', label: t('viewMasonry') },
                      { value: 'folder', label: t('viewFolder') },
                    ]}
                    ariaLabel={t('defaultViewMode')}
                    className="w-full"
                  />
                </label>

                <label className="block">
                  <span className="ui-label">{t('defaultSort')}</span>
                  <Dropdown<SortOrder>
                    size="sm"
                    value={draft.defaultSort}
                    onChange={(defaultSort) => setDraft((d) => ({ ...d, defaultSort }))}
                    options={[
                      { value: 'newest', label: t('newest') },
                      { value: 'oldest', label: t('oldest') },
                      { value: 'a-z', label: t('az') },
                      { value: 'z-a', label: t('za') },
                      { value: 'domain', label: t('domain') },
                      { value: 'updated', label: t('updated') },
                    ]}
                    ariaLabel={t('defaultSort')}
                    className="w-full"
                  />
                </label>
              </div>

              <label className="block">
                <span className="ui-label">{t('defaultCollection')}</span>
                <Dropdown
                  size="sm"
                  value={draft.defaultCollectionId}
                  onChange={(defaultCollectionId) =>
                    setDraft((d) => ({ ...d, defaultCollectionId }))
                  }
                  options={collectionOptions}
                  ariaLabel={t('defaultCollection')}
                  className="w-full"
                />
              </label>

              <label className="block">
                <span className="ui-label">{t('trashAutoEmpty')}</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={trashDaysInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setTrashDaysInput(raw);
                    const n = raw === '' ? 0 : Math.max(0, Math.min(365, Number(raw)));
                    if (Number.isFinite(n)) setDraft((d) => ({ ...d, trashAutoEmptyDays: n }));
                  }}
                  onBlur={() => setTrashDaysInput(String(draft.trashAutoEmptyDays))}
                  className="ui-input w-full"
                />
                <span className="text-[11px] text-[var(--text-muted)] block mt-1">
                  {t('trashAutoEmptyHint')}
                </span>
              </label>

              <div className="pt-2 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                <SettingSwitchRow
                  checked={draft.fetchPreviews}
                  onChange={(fetchPreviews) => setDraft((d) => ({ ...d, fetchPreviews }))}
                  label={t('fetchPreviewsToggle')}
                />
                <SettingSwitchRow
                  checked={draft.showQuickSave}
                  onChange={(showQuickSave) => setDraft((d) => ({ ...d, showQuickSave }))}
                  label={t('quickSaveToggle')}
                />
                <SettingSwitchRow
                  checked={draft.openInSidePanel}
                  onChange={(openInSidePanel) => setDraft((d) => ({ ...d, openInSidePanel }))}
                  label={t('sidePanelToggle')}
                />
              </div>
            </section>
          )}

          {activeTab === 'sync' && (
            <section className="space-y-3" aria-label={t('tabSync')}>
              {gdrive && !gdrive.configured && (
                <div className="ui-notice ui-notice--warn">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-[var(--warning)]" />
                  <span>{t('gdriveNotConfigured')}</span>
                </div>
              )}

              <div
                id="gdrive-section"
                className={`rounded-[var(--radius-lg)] border bg-[var(--bg)] p-3.5 space-y-3 ${
                  autoConnectGDrive
                    ? 'border-[var(--accent)] ring-2 ring-[rgba(59,130,246,0.18)]'
                    : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {gdrive?.connected && gdrive.account?.photoUrl ? (
                    <img
                      src={gdrive.account.photoUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-full shrink-0 bg-[var(--surface-2)]"
                    />
                  ) : gdrive?.connected ? (
                    <Cloud className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  ) : (
                    <CloudOff className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[var(--text)] truncate m-0">
                      {gdrive?.connected
                        ? gdrive.account?.email || gdrive.account?.displayName || 'Google'
                        : t('gdriveNotConnected')}
                    </p>
                    {gdrive?.connected && (
                      <p className="text-[11.5px] text-[var(--text-muted)] truncate m-0 mt-0.5">
                        {t('gdriveLastSync')}:{' '}
                        {gdrive.lastSyncAt ? (
                          <time
                            dateTime={new Date(gdrive.lastSyncAt).toISOString()}
                            title={formatAbsoluteTime(gdrive.lastSyncAt, driveLocale)}
                            className="cursor-help underline decoration-dotted underline-offset-2"
                          >
                            {formatRelativeTime(gdrive.lastSyncAt, driveLocale)}
                          </time>
                        ) : (
                          t('gdriveNever')
                        )}
                      </p>
                    )}
                  </div>
                  {statusChip && (
                    <span
                      className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                      style={{ color: statusChip.color, backgroundColor: statusChip.bg }}
                      role="status"
                    >
                      {statusChip.label}
                    </span>
                  )}
                </div>

                {(driveErr || gdriveError) && (
                  <div
                    className={`ui-notice ${
                      gdrive?.status === 'needs_reauth' ? 'ui-notice--warn' : 'ui-notice--danger'
                    }`}
                    role="alert"
                  >
                    <AlertTriangle
                      size={15}
                      className="shrink-0 mt-0.5"
                      style={{
                        color:
                          gdrive?.status === 'needs_reauth' ? 'var(--warning)' : 'var(--danger)',
                      }}
                    />
                    <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                      {driveErr ? (
                        <>
                          <p className="font-semibold m-0">{driveErr.title}</p>
                          {driveErr.hint && (
                            <p className="mt-0.5 mb-0 text-[var(--text-muted)]">{driveErr.hint}</p>
                          )}
                        </>
                      ) : (
                        gdriveError
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {!gdrive?.connected || gdrive.needsReauth ? (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || gdrive?.configured === false}
                      onClick={handleConnect}
                    >
                      {gdriveBusy === 'connect' ? (
                        <Loader2 size={14} className="ui-spin" />
                      ) : (
                        <Cloud size={14} />
                      )}
                      <span>
                        {gdriveBusy === 'connect'
                          ? t('gdriveConnecting')
                          : gdrive?.needsReauth
                            ? t('gdriveReconnect')
                            : t('gdriveConnect')}
                      </span>
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || gdrive.syncing}
                      onClick={handleSync}
                    >
                      {gdriveBusy === 'sync' || gdrive.syncing ? (
                        <Loader2 size={14} className="ui-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      <span>
                        {gdriveBusy === 'sync' || gdrive.syncing
                          ? t('gdriveSyncing')
                          : t('gdriveSyncNow')}
                      </span>
                    </Button>
                  )}
                  {gdrive?.connected && (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={handleDisconnect}>
                      {gdriveBusy === 'disconnect' ? <Loader2 size={14} className="ui-spin" /> : null}
                      <span>{t('gdriveDisconnect')}</span>
                    </Button>
                  )}
                </div>
              </div>

              <SettingSwitchRow
                checked={draft.gdriveAutoSync !== false}
                onChange={(gdriveAutoSync) => setDraft((d) => ({ ...d, gdriveAutoSync }))}
                label={t('gdriveAutoSync')}
              />
              <p className="text-[11.5px] text-[var(--text-muted)] m-0">{t('gdriveDesc')}</p>

              {gdrive && (
                <details
                  className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-[11.5px] text-[var(--text-muted)]"
                  open={
                    Boolean(driveErr && gdrive.lastError?.code !== 'needs_reauth') || undefined
                  }
                >
                  <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
                    {t('gdriveAdvanced')}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="space-y-2">
                      <CopyRow
                        label={t('extensionId')}
                        value={gdrive.extensionId}
                        copyLabel={t('copy')}
                        copiedLabel={t('copied')}
                      />
                      <CopyRow
                        label={t('redirectUri')}
                        value={gdrive.redirectUri}
                        copyLabel={t('copy')}
                        copiedLabel={t('copied')}
                      />
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
                      <p className="font-semibold text-[var(--text)] m-0">
                        {t('gdriveBackupTitle')}
                      </p>
                      <p className="m-0">{t('gdriveBackupDesc')}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || !gdrive.backupAt}
                        onClick={handleDownloadBackup}
                      >
                        {gdriveBusy === 'backup' ? (
                          <Loader2 size={13} className="ui-spin" />
                        ) : (
                          <Download size={13} />
                        )}
                        <span>
                          {gdrive.backupAt
                            ? `${t('gdriveBackupDownload')} · ${formatAbsoluteTime(gdrive.backupAt, driveLocale)}`
                            : t('gdriveBackupNone')}
                        </span>
                      </Button>
                    </div>

                    {gdrive.connected && (
                      <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
                        <p className="font-semibold text-[var(--danger)] m-0">
                          {t('gdriveDeleteRemote')}
                        </p>
                        <p className="m-0">{t('gdriveDeleteRemoteDesc')}</p>
                        <Button
                          variant="danger-subtle"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmDelete(true)}
                        >
                          {gdriveBusy === 'delete' ? (
                            <Loader2 size={13} className="ui-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          <span>{t('gdriveDeleteRemote')}</span>
                        </Button>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </section>
          )}

          {activeTab === 'data' && (
            <section className="space-y-4" aria-label={t('tabData')}>
              {stats && (
                <div className="space-y-1.5">
                  <p className="section-label m-0">{t('libraryStats')}</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    <StatTile label={t('statBookmarks')} value={stats.totalBookmarks} />
                    <StatTile label={t('statCollections')} value={stats.totalCollections} />
                    <StatTile label={t('statTags')} value={stats.totalTags} />
                    <StatTile label={t('statPinned')} value={stats.pinnedCount} />
                    <StatTile
                      label={t('statBroken')}
                      value={stats.brokenCount}
                      alert={stats.brokenCount > 0}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="section-label m-0">{t('importExport')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {onImportJson && (
                    <ActionButton onClick={onImportJson} icon={Upload} label={t('importJson')} />
                  )}
                  {onExport && (
                    <ActionButton onClick={onExport} icon={Download} label={t('exportJson')} />
                  )}
                  {onImportHtml && (
                    <ActionButton
                      onClick={onImportHtml}
                      icon={FileCode2}
                      label={t('importHtml')}
                    />
                  )}
                  {onExportHtml && (
                    <ActionButton
                      onClick={onExportHtml}
                      icon={FileCode2}
                      label={t('exportHtml')}
                    />
                  )}
                  {onImportBrowser && (
                    <div className="sm:col-span-2">
                      <ActionButton
                        onClick={onImportBrowser}
                        icon={Database}
                        label={t('importBrowser')}
                      />
                    </div>
                  )}
                </div>
              </div>

              {(onRefreshPreviews || onCheckBroken || onEmptyOldTrash) && (
                <div className="space-y-1.5 pt-3 border-t border-[var(--border)]">
                  <p className="section-label m-0">{t('maintenance')}</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {onRefreshPreviews && (
                      <ActionButton
                        onClick={onRefreshPreviews}
                        icon={RefreshCw}
                        label={t('fetchPreviews')}
                      />
                    )}
                    {onCheckBroken && (
                      <ActionButton
                        onClick={onCheckBroken}
                        icon={Link2Off}
                        label={t('checkBroken')}
                      />
                    )}
                    {onEmptyOldTrash && (
                      <ActionButton
                        onClick={onEmptyOldTrash}
                        icon={Trash2}
                        label={t('emptyOldTrash')}
                      />
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'shortcuts' && (
            <section aria-label={t('tabShortcuts')}>
              <ul className="text-[12.5px] text-[var(--text)] divide-y divide-[var(--border)] m-0 p-0 list-none">
                <ShortcutRow label={t('shortcutCommandPalette')} keys="Ctrl/⌘ + K" />
                <ShortcutRow label={t('shortcutSearch')} keys="/" />
                <ShortcutRow label={t('shortcutNewBookmark')} keys="N" />
                <ShortcutRow label={t('shortcutNavigate')} keys="J / K · ↑ / ↓" />
                <ShortcutRow label={t('shortcutOpenSelected')} keys="Enter" />
                <ShortcutRow label={t('shortcutEditFocused')} keys="E / P / C" />
                <ShortcutRow label={t('shortcutSubmitModal')} keys="Ctrl/⌘ + Enter" />
                <ShortcutRow label={t('shortcutSave')} keys="Ctrl/⌘ + Shift + Y" />
                <ShortcutRow label={t('shortcutDashboard')} keys="Ctrl/⌘ + Shift + B" />
                <ShortcutRow label="Omnibox" keys="bm + query" />
              </ul>
            </section>
          )}
        </div>
      </Dialog>

      {confirmDelete && (
        <ConfirmDialog
          locale={draft.locale}
          onClose={() => setConfirmDelete(false)}
          dialog={{
            title: t('gdriveDeleteRemote'),
            message: t('gdriveDeleteRemoteConfirm'),
            confirmLabel: t('gdriveDeleteRemote'),
            variant: 'danger',
            onConfirm: handleDeleteRemote,
          }}
        />
      )}
    </>
  );
}

function StatTile({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-center">
      <p
        className={`text-[15px] font-bold tabular-nums leading-tight m-0 ${
          alert ? 'text-[var(--danger)]' : 'text-[var(--text)]'
        }`}
      >
        {value}
      </p>
      <p className="text-[10.5px] font-medium text-[var(--text-muted)] truncate mt-0.5 mb-0">
        {label}
      </p>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>{label}</span>
      <kbd className="px-2 py-0.5 rounded-[6px] bg-[var(--surface-2)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)] shrink-0">
        {keys}
      </kbd>
    </li>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} className="w-full !justify-start">
      <Icon size={14} className="shrink-0 text-[var(--text-muted)]" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function SettingSwitchRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[13px] font-medium text-[var(--text)]">{label}</span>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function CopyRow({
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
        <button
          type="button"
          className="text-[11px] font-medium text-[var(--accent)] hover:underline shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <p className="text-[11px] text-[var(--text)] font-mono break-all select-all m-0">{value}</p>
    </div>
  );
}
