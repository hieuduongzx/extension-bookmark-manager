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
import type { GDriveStatus } from '../gdrive';

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

function formatSyncTime(ts: number | null, neverLabel: string, locale: LocaleCode): string {
  if (!ts) return neverLabel;
  try {
    return new Date(ts).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

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
  const [gdriveBusy, setGdriveBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [gdriveError, setGdriveError] = useState<string | null>(null);
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
      setGdriveError((response as GDriveStatus)?.lastError ?? null);
    });
  }, []);

  useEffect(() => {
    refreshGDrive();
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

  const sendGDrive = (msg: Message): Promise<{ error?: string; gdrive?: GDriveStatus }> =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response ?? {});
      });
    });

  const failGDrive = (message: string) => {
    setGdriveError(message);
    onToast?.(message.split('\n')[0] || t('gdriveSyncFailed'));
  };

  const handleConnect = async () => {
    const isPopup = !window.location.search.includes('target=dashboard');
    if (isPopup) {
      const url = chrome.runtime.getURL('index.html?target=dashboard&gdrive=connect');
      await chrome.tabs.create({ url });
      onClose();
      return;
    }

    setGdriveBusy('connect');
    setGdriveError(null);
    try {
      const res = await sendGDrive({ type: 'BM:gdriveConnect' });
      if (res.error) {
        failGDrive(res.error);
      } else {
        onToast?.(t('gdriveConnectSuccess'));
        onGDriveStateChange?.();
      }
      if (res.gdrive) setGdrive(res.gdrive);
      else refreshGDrive();
    } catch (err) {
      failGDrive(err instanceof Error ? err.message : String(err));
    } finally {
      setGdriveBusy(null);
    }
  };

  const handleSync = async () => {
    setGdriveBusy('sync');
    setGdriveError(null);
    try {
      const res = await sendGDrive({ type: 'BM:gdriveSync' });
      if (res.error) {
        failGDrive(res.error);
      } else {
        onToast?.(t('gdriveSyncSuccess'));
        onGDriveStateChange?.();
      }
      if (res.gdrive) setGdrive(res.gdrive);
      else refreshGDrive();
    } catch (err) {
      failGDrive(err instanceof Error ? err.message : String(err));
    } finally {
      setGdriveBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setGdriveBusy('disconnect');
    setGdriveError(null);
    try {
      const res = await sendGDrive({ type: 'BM:gdriveDisconnect' });
      if (res.error) {
        setGdriveError(res.error);
      } else {
        onToast?.(t('gdriveDisconnected'));
      }
      if (res.gdrive) setGdrive(res.gdrive);
      else refreshGDrive();
    } catch (err) {
      setGdriveError(err instanceof Error ? err.message : String(err));
    } finally {
      setGdriveBusy(null);
    }
  };

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
                  {gdrive?.connected ? (
                    <Cloud className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                  ) : (
                    <CloudOff className="w-4 h-4 text-zinc-400 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                      {gdrive?.connected ? gdrive.email || 'Google' : t('gdriveNotConnected')}
                    </p>
                    {gdrive?.connected && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {t('gdriveLastSync')}:{' '}
                        {formatSyncTime(gdrive.lastSyncAt, t('gdriveNever'), draft.locale)}
                      </p>
                    )}
                  </div>
                </div>

                {gdriveError && (
                  <p
                    className="text-[11px] text-rose-600 dark:text-rose-400 break-words whitespace-pre-wrap"
                    role="alert"
                  >
                    {gdriveError}
                  </p>
                )}

                {(!gdrive?.connected || gdriveError) && gdrive?.redirectUri && (
                  <details className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200">
                      {t('gdriveSetupDetails')}
                    </summary>
                    <div className="mt-1.5 space-y-1.5 pl-0.5">
                      {gdrive.extensionId && (
                        <CopyRow
                          label={t('extensionId')}
                          value={gdrive.extensionId}
                          copyLabel={t('copy')}
                          copiedLabel={t('copied')}
                        />
                      )}
                      <CopyRow
                        label={t('redirectUri')}
                        value={gdrive.redirectUri}
                        copyLabel={t('copy')}
                        copiedLabel={t('copied')}
                      />
                    </div>
                  </details>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {!gdrive?.connected ? (
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
                      {gdriveBusy === 'connect' ? t('gdriveConnecting') : t('gdriveConnect')}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSync}
                        className="btn-brand-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {gdriveBusy === 'sync' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        {gdriveBusy === 'sync' ? t('gdriveSyncing') : t('gdriveSyncNow')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleDisconnect}
                        className="btn-ghost-sm inline-flex items-center gap-1.5 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                      >
                        {gdriveBusy === 'disconnect' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : null}
                        {t('gdriveDisconnect')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <Toggle
                checked={draft.gdriveAutoSync !== false}
                onChange={(gdriveAutoSync) => setDraft((d) => ({ ...d, gdriveAutoSync }))}
                label={t('gdriveAutoSync')}
              />
              <p className="text-[11px] text-zinc-400">{t('gdriveDesc')}</p>
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
