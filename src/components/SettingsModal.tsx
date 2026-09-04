import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, Keyboard, Loader2, RefreshCw, X } from 'lucide-react';
import type { AppSettings, Collection, LocaleCode, Message, ThemeMode } from '../types';
import { COLLECTION } from '../types';
import { createT, t as translate } from '../i18n';
import { useEscapeKey, useFocusTrap } from '../hooks';
import { Dropdown } from './Dropdown';
import type { GDriveStatus } from '../gdrive';

interface SettingsModalProps {
  settings: AppSettings;
  collections: Collection[];
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
  onCheckBroken?: () => void;
  onEmptyOldTrash?: () => void;
  onGDriveStateChange?: () => void;
  onToast?: (msg: string) => void;
  /** When true, start Google Drive connect once after mount (dashboard deep-link) */
  autoConnectGDrive?: boolean;
}

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
  onSave,
  onClose,
  onCheckBroken,
  onEmptyOldTrash,
  onGDriveStateChange,
  onToast,
  autoConnectGDrive = false,
}: SettingsModalProps) {
  const t = createT(settings.locale);
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [trashDaysInput, setTrashDaysInput] = useState(String(settings.trashAutoEmptyDays));
  const [saving, setSaving] = useState(false);
  const [gdrive, setGdrive] = useState<GDriveStatus | null>(null);
  const [gdriveBusy, setGdriveBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [gdriveError, setGdriveError] = useState<string | null>(null);
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeKey(onClose);

  // Move focus into the dialog on open so the focus trap actually engages (otherwise focus
  // stays on the outside trigger and Tab escapes the modal until the user tabs in).
  useEffect(() => {
    containerRef.current?.focus();
  }, [containerRef]);

  const collectionOptions = [
    { value: COLLECTION.UNSORTED, label: t('unsorted') },
    ...collections.map((c) => ({ value: c.id, label: c.name })),
  ];

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
    // Show concrete reason, not only the generic toast
    onToast?.(message.split('\n')[0] || t('gdriveSyncFailed'));
  };

  const handleConnect = async () => {
    // Popup closes when the OAuth window steals focus → open full Dashboard tab
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

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-[2px]">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-pop animate-scale-in focus:outline-none"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
          <h2 id="settings-title" className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">
            {t('settings')}
          </h2>
          <button type="button" onClick={onClose} className="btn-icon-sm dark:hover:bg-zinc-800" aria-label={t('close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Google Drive — compact */}
          <section className="space-y-2">
            <p className="section-label flex items-center gap-1.5">
              <Cloud className="w-3 h-3" /> {t('gdriveSection')}
            </p>

            {gdrive && !gdrive.configured && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">{t('gdriveNotConfigured')}</p>
            )}

            <div
              id="gdrive-section"
              className={`rounded-xl border bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5 space-y-2 ${
                autoConnectGDrive
                  ? 'border-brand-400 dark:border-brand-500 ring-2 ring-brand-500/20'
                  : 'border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                {gdrive?.connected ? (
                  <Cloud className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                ) : (
                  <CloudOff className="w-4 h-4 text-zinc-400 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100 truncate">
                    {gdrive?.connected
                      ? gdrive.email || 'Google'
                      : t('gdriveNotConnected')}
                  </p>
                  {gdrive?.connected && (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {t('gdriveLastSync')}:{' '}
                      {formatSyncTime(gdrive.lastSyncAt, t('gdriveNever'), settings.locale)}
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

              {/* Setup details only when not connected or auth error */}
              {(!gdrive?.connected || gdriveError) && gdrive?.redirectUri && (
                <details className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200">
                    {t('gdriveSetupDetails')}
                  </summary>
                  <div className="mt-1.5 space-y-1.5 pl-0.5">
                    {gdrive.extensionId && (
                      <CopyRow label={t('extensionId')} value={gdrive.extensionId} />
                    )}
                    <CopyRow label={t('redirectUri')} value={gdrive.redirectUri} />
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
          </section>

          <section className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="section-label">{t('preferences')}</p>

            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">{t('theme')}</span>
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
              <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">{t('language')}</span>
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

            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                {t('defaultCollection')}
              </span>
              <Dropdown
                value={draft.defaultCollectionId}
                onChange={(defaultCollectionId) => setDraft((d) => ({ ...d, defaultCollectionId }))}
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
                  // Allow the field to be blank while retyping; treat blank as 0 in the draft.
                  const n = raw === '' ? 0 : Math.max(0, Math.min(365, Number(raw)));
                  if (Number.isFinite(n)) setDraft((d) => ({ ...d, trashAutoEmptyDays: n }));
                }}
                onBlur={() => setTrashDaysInput(String(draft.trashAutoEmptyDays))}
                className="brand-input w-full dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              />
              <span className="text-[11px] text-zinc-400">{t('trashAutoEmptyHint')}</span>
            </label>

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
          </section>

          <section className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="section-label flex items-center gap-1.5">
              <Keyboard className="w-3 h-3" /> {t('shortcuts')}
            </p>
            <ul className="text-[12px] text-zinc-600 dark:text-zinc-300 space-y-1.5">
              <li className="flex justify-between gap-3">
                <span>{t('shortcutSave')}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                  Ctrl/⌘+Shift+Y
                </kbd>
              </li>
              <li className="flex justify-between gap-3">
                <span>{t('shortcutDashboard')}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                  Ctrl/⌘+Shift+B
                </kbd>
              </li>
              <li className="flex justify-between gap-3">
                <span>{t('shortcutSearch')}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                  /
                </kbd>
              </li>
              <li className="flex justify-between gap-3">
                <span>Omnibox</span>
                <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                  bm + query
                </kbd>
              </li>
            </ul>
          </section>

          {(onCheckBroken || onEmptyOldTrash) && (
            <section className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <p className="section-label">{t('maintenance')}</p>
              <div className="flex flex-col gap-1.5">
                {onCheckBroken && (
                  <button
                    type="button"
                    onClick={onCheckBroken}
                    className="btn-ghost-sm w-full justify-start dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
                  >
                    {t('checkBroken')}
                  </button>
                )}
                {onEmptyOldTrash && (
                  <button
                    type="button"
                    onClick={onEmptyOldTrash}
                    className="btn-ghost-sm w-full justify-start dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
                  >
                    {t('emptyOldTrash')}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-700 flex justify-end gap-2 sticky bottom-0 bg-white dark:bg-zinc-900">
          <button type="button" onClick={onClose} className="btn-ghost-sm dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
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
      <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      <span
        className={`relative w-9 h-5 rounded-full transition-colors ${
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

function CopyRow({ label, value }: { label: string; value: string }) {
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
          {copied ? translate('copied') : translate('copy')}
        </button>
      </div>
      <p className="text-[10px] text-zinc-700 dark:text-zinc-300 font-mono break-all select-all">
        {value}
      </p>
    </div>
  );
}
