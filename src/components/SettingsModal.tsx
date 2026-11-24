import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  X,
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
import { useEscapeKey, useFocusTrap } from '../hooks';
import { Dropdown } from './Dropdown';
import type { DriveBackup, GDriveStatus } from '../driveSync';
import {
  formatAbsoluteTime,
  formatDriveError,
  formatRelativeTime,
} from '../shared/driveSync/strings';
import { ConfirmDialog } from './ConfirmDialog';

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
  /** Transport-level error (messaging failed); Drive errors come from gdrive.lastError */
  const [gdriveError, setGdriveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, setClock] = useState(0);
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose);

  useEffect(() => {
    containerRef.current?.focus();
  }, [containerRef]);

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
    // Live status while a background sync runs, and a ticking "x minutes ago".
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
    // The OAuth window closes the popup, so sign in from the full Dashboard tab.
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
        cls: 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
      };
    }
    switch (gdrive.status) {
      case 'needs_reauth':
        return {
          label: t('gdriveStatusNeedsReauth'),
          cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
        };
      case 'error':
        return {
          label: t('gdriveStatusError'),
          cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
        };
      case 'synced':
        return {
          label: t('gdriveStatusSynced'),
          cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
        };
      default:
        return {
          label: t('gdriveStatusIdle'),
          cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
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
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-zinc-900/45 dark:bg-black/65 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-pop animate-scale-in focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200/80 dark:border-zinc-800 shrink-0">
          <h2 id="settings-title" className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">
            {t('settings')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-sm dark:hover:bg-zinc-800"
            aria-label={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div role="tablist" aria-label={t('settings')} className="flex gap-1 px-4 pt-3 shrink-0">
          {tabs.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                activeTab === id
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                  : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
          {activeTab === 'general' && (
            <section className="space-y-3" aria-label={t('tabGeneral')}>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                    {t('theme')}
                  </span>
                  <Dropdown<ThemeMode>
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

                <label className="block space-y-1">
                  <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                    {t('language')}
                  </span>
                  <Dropdown<LocaleCode>
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
                <label className="block space-y-1">
                  <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                    {t('defaultViewMode')}
                  </span>
                  <Dropdown<ViewMode>
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

                <label className="block space-y-1">
                  <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                    {t('defaultSort')}
                  </span>
                  <Dropdown<SortOrder>
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

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                  {t('defaultCollection')}
                </span>
                <Dropdown
                  value={draft.defaultCollectionId}
                  onChange={(defaultCollectionId) =>
                    setDraft((d) => ({ ...d, defaultCollectionId }))
                  }
                  options={collectionOptions}
                  ariaLabel={t('defaultCollection')}
                  className="w-full"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                  {t('trashAutoEmpty')}
                </span>
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
                  className="brand-input w-full dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
                />
                <span className="text-[11px] text-zinc-400">{t('trashAutoEmptyHint')}</span>
              </label>

              <div className="pt-2 space-y-0.5 border-t border-zinc-100 dark:border-zinc-800">
                <Toggle
                  checked={draft.fetchPreviews}
                  onChange={(fetchPreviews) => setDraft((d) => ({ ...d, fetchPreviews }))}
                  label={t('fetchPreviewsToggle')}
                />
                <Toggle
                  checked={draft.showQuickSave}
                  onChange={(showQuickSave) => setDraft((d) => ({ ...d, showQuickSave }))}
                  label={t('quickSaveToggle')}
                />
                <Toggle
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
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  {t('gdriveNotConfigured')}
                </p>
              )}

              <div
                id="gdrive-section"
                className={`rounded-xl border bg-zinc-50 dark:bg-zinc-800/50 px-3.5 py-3 space-y-2.5 ${
                  autoConnectGDrive
                    ? 'border-brand-400 dark:border-brand-500 ring-2 ring-brand-500/20'
                    : 'border-zinc-200 dark:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {gdrive?.connected && gdrive.account?.photoUrl ? (
                    <img
                      src={gdrive.account.photoUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-full shrink-0 bg-zinc-200 dark:bg-zinc-700"
                    />
                  ) : gdrive?.connected ? (
                    <Cloud className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                  ) : (
                    <CloudOff className="w-4 h-4 text-zinc-400 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                      {gdrive?.connected
                        ? gdrive.account?.email || gdrive.account?.displayName || 'Google'
                        : t('gdriveNotConnected')}
                    </p>
                    {gdrive?.connected && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
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
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${statusChip.cls}`}
                      role="status"
                    >
                      {statusChip.label}
                    </span>
                  )}
                </div>

                {(driveErr || gdriveError) && (
                  <div
                    className={`rounded-lg px-2.5 py-2 text-[11px] break-words whitespace-pre-wrap ${
                      gdrive?.status === 'needs_reauth'
                        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                    }`}
                    role="alert"
                  >
                    {driveErr ? (
                      <>
                        <p className="font-semibold">{driveErr.title}</p>
                        {driveErr.hint && <p className="mt-0.5 opacity-90">{driveErr.hint}</p>}
                      </>
                    ) : (
                      gdriveError
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {!gdrive?.connected || gdrive.needsReauth ? (
                    <button
                      type="button"
                      disabled={busy || gdrive?.configured === false}
                      onClick={handleConnect}
                      className="btn-brand-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {gdriveBusy === 'connect' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Cloud className="w-3.5 h-3.5" />
                      )}
                      {gdriveBusy === 'connect'
                        ? t('gdriveConnecting')
                        : gdrive?.needsReauth
                          ? t('gdriveReconnect')
                          : t('gdriveConnect')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || gdrive.syncing}
                      onClick={handleSync}
                      className="btn-brand-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {gdriveBusy === 'sync' || gdrive.syncing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      {gdriveBusy === 'sync' || gdrive.syncing ? t('gdriveSyncing') : t('gdriveSyncNow')}
                    </button>
                  )}
                  {gdrive?.connected && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleDisconnect}
                      className="btn-ghost-sm inline-flex items-center gap-1.5 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                    >
                      {gdriveBusy === 'disconnect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {t('gdriveDisconnect')}
                    </button>
                  )}
                </div>
              </div>

              <Toggle
                checked={draft.gdriveAutoSync !== false}
                onChange={(gdriveAutoSync) => setDraft((d) => ({ ...d, gdriveAutoSync }))}
                label={t('gdriveAutoSync')}
              />
              <p className="text-[11px] text-zinc-400">{t('gdriveDesc')}</p>

              {gdrive && (
                <details
                  className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-3.5 py-2.5 text-[11px] text-zinc-500 dark:text-zinc-400"
                  open={Boolean(driveErr && gdrive.lastError?.code !== 'needs_reauth') || undefined}
                >
                  <summary className="cursor-pointer select-none font-semibold text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100">
                    {t('gdriveAdvanced')}
                  </summary>
                  <div className="mt-2.5 space-y-3">
                    <div className="space-y-1.5">
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

                    <div className="space-y-1">
                      <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                        {t('gdriveBackupTitle')}
                      </p>
                      <p>{t('gdriveBackupDesc')}</p>
                      <button
                        type="button"
                        disabled={busy || !gdrive.backupAt}
                        onClick={handleDownloadBackup}
                        className="btn-ghost-sm inline-flex items-center gap-1.5 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                      >
                        {gdriveBusy === 'backup' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        {gdrive.backupAt
                          ? `${t('gdriveBackupDownload')} · ${formatAbsoluteTime(gdrive.backupAt, driveLocale)}`
                          : t('gdriveBackupNone')}
                      </button>
                    </div>

                    {gdrive.connected && (
                      <div className="space-y-1">
                        <p className="font-semibold text-rose-700 dark:text-rose-300">
                          {t('gdriveDeleteRemote')}
                        </p>
                        <p>{t('gdriveDeleteRemoteDesc')}</p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmDelete(true)}
                          className="btn-ghost-sm inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 dark:bg-zinc-800 dark:border-zinc-700 disabled:opacity-50"
                        >
                          {gdriveBusy === 'delete' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          {t('gdriveDeleteRemote')}
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              )}

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
            </section>
          )}

          {activeTab === 'data' && (
            <section className="space-y-4" aria-label={t('tabData')}>
              {stats && (
                <div className="space-y-1.5">
                  <p className="section-label">{t('libraryStats')}</p>
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
                <p className="section-label">{t('importExport')}</p>
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
                <div className="space-y-1.5 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="section-label">{t('maintenance')}</p>
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
              <ul className="text-[12.5px] text-zinc-600 dark:text-zinc-300 divide-y divide-zinc-100 dark:divide-zinc-800">
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

        <div className="px-5 py-3.5 border-t border-zinc-200/80 dark:border-zinc-800 flex justify-end gap-2 shrink-0 bg-zinc-50/60 dark:bg-zinc-800/40 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost-sm dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
          >
            {t('cancel')}
          </button>
          <button type="button" disabled={saving} onClick={handleSave} className="btn-brand-sm">
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/50 px-2 py-2 text-center">
      <p
        className={`text-[15px] font-bold tabular-nums leading-tight ${
          alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-50'
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
        {label}
      </p>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span>{label}</span>
      <kbd className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700 font-mono text-[11px] text-zinc-700 dark:text-zinc-200 shrink-0">
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
    <button
      type="button"
      onClick={onClick}
      className="btn-ghost-sm w-full justify-start dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
    >
      <Icon className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 py-1.5 text-left"
    >
      <span className="text-[12.5px] font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      <span
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-brand-600' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
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
        <span className="text-[10px] text-zinc-500">{label}</span>
        <button
          type="button"
          className="text-[10px] font-medium text-brand-600 dark:text-brand-400 hover:underline shrink-0"
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
      <p className="text-[10px] text-zinc-700 dark:text-zinc-300 font-mono break-all select-all">
        {value}
      </p>
    </div>
  );
}
