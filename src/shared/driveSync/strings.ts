/**
 * Shared Google Drive sync module — user-facing error texts (vi / en) and time helpers.
 * Pure functions, no chrome.* access: safe to import from UI code.
 */
import type { DriveErrorInfo } from './types.ts';

export type DriveLocale = 'vi' | 'en';

export interface DriveErrorContext {
  redirectUri: string;
  extensionId: string;
}

export interface DriveErrorText {
  /** One line, suitable for a toast */
  title: string;
  /** Optional multi-line guidance */
  hint?: string;
}

type Builder = (ctx: DriveErrorContext, info: DriveErrorInfo) => DriveErrorText;

const VI: Record<DriveErrorInfo['code'], Builder> = {
  not_configured: () => ({
    title: 'Chưa cấu hình Google OAuth Client ID.',
    hint: 'Đặt VITE_GOOGLE_CLIENT_ID rồi build lại tiện ích.',
  }),
  redirect_uri_mismatch: (c) => ({
    title: 'redirect_uri_mismatch — Redirect URI chưa được đăng ký.',
    hint:
      `Google Cloud → Credentials → OAuth client (Web application)\n` +
      `→ Authorized redirect URIs → thêm đúng:\n${c.redirectUri}\n(Extension ID: ${c.extensionId})`,
  }),
  invalid_client: (c) => ({
    title: 'OAuth Client ID không hợp lệ hoặc sai loại.',
    hint: `Client phải là loại Web application, có Redirect URI:\n${c.redirectUri}`,
  }),
  access_denied: () => ({
    title: 'Google chặn đăng nhập.',
    hint:
      'App có thể đang ở chế độ Testing hoặc bạn chưa là test user.\n' +
      '→ OAuth consent screen → Test users → thêm email Google của bạn, hoặc chuyển sang In production.',
  }),
  oauth_disabled: () => ({
    title: 'OAuth bị tắt cho client này.',
    hint: 'Kiểm tra OAuth consent screen / Client ID trong Google Cloud.',
  }),
  cancelled: () => ({
    title: 'Bạn đã huỷ đăng nhập Google, hoặc cửa sổ đăng nhập bị chặn.',
    hint: 'Bấm Kết nối lại và cho phép quyền.',
  }),
  user_gesture: () => ({
    title: 'Cần thao tác trực tiếp từ người dùng.',
    hint: 'Mở Dashboard (tab đầy đủ) → Cài đặt → Đồng bộ → Kết nối.',
  }),
  auth_failed: (_c, i) => ({ title: 'Đăng nhập Google thất bại.', hint: i.detail }),
  needs_reauth: () => ({
    title: 'Phiên đăng nhập Google đã hết hạn.',
    hint: 'Bấm "Đăng nhập lại" để tiếp tục đồng bộ. Dữ liệu trên máy vẫn an toàn.',
  }),
  api_disabled: () => ({
    title: 'Google Drive API chưa được bật cho project.',
    hint: 'Google Cloud → APIs & Services → Library → bật "Google Drive API", đợi ~1 phút rồi thử lại.',
  }),
  insufficient_scope: () => ({
    title: 'Token không đủ quyền Drive App Data.',
    hint: 'Ngắt kết nối → Kết nối lại và chấp nhận toàn bộ quyền.',
  }),
  rate_limited: () => ({
    title: 'Google Drive đang giới hạn tốc độ (429).',
    hint: 'Tiện ích sẽ tự thử lại sau ít phút.',
  }),
  server: (_c, i) => ({
    title: `Máy chủ Google Drive lỗi (${i.status ?? '5xx'}).`,
    hint: 'Tiện ích sẽ tự thử lại sau ít phút.',
  }),
  network: () => ({
    title: 'Lỗi kết nối mạng tới Google Drive.',
    hint: 'Dữ liệu trên máy vẫn an toàn. Tiện ích sẽ tự thử lại.',
  }),
  offline: () => ({ title: 'Đang offline — chưa thể đồng bộ.' }),
  corrupt_remote: (_c, i) => ({
    title: 'File đồng bộ trên Drive bị hỏng — đã giữ nguyên dữ liệu trên máy.',
    hint: `${i.detail ?? ''}\nCó thể dùng "Xoá dữ liệu trên Drive" (mục Nâng cao) để tạo lại file từ máy này.`.trim(),
  }),
  schema_too_new: () => ({
    title: 'File đồng bộ được tạo bởi phiên bản tiện ích mới hơn.',
    hint: 'Hãy cập nhật Bookmark Manager trên máy này. Không có dữ liệu nào bị ghi đè.',
  }),
  conflict: () => ({
    title: 'Thiết bị khác đang ghi cùng lúc.',
    hint: 'Tiện ích sẽ tự thử lại; hoặc bấm Đồng bộ ngay.',
  }),
  http: (_c, i) => ({ title: `Lỗi Google Drive API (${i.status ?? '?'})`, hint: i.detail }),
  unknown: (_c, i) => ({ title: 'Đồng bộ Google Drive thất bại.', hint: i.detail }),
};

const EN: Record<DriveErrorInfo['code'], Builder> = {
  not_configured: () => ({
    title: 'Google OAuth client ID is not configured.',
    hint: 'Set VITE_GOOGLE_CLIENT_ID and rebuild the extension.',
  }),
  redirect_uri_mismatch: (c) => ({
    title: 'redirect_uri_mismatch — the redirect URI is not registered.',
    hint:
      `Google Cloud → Credentials → OAuth client (Web application)\n` +
      `→ Authorized redirect URIs → add exactly:\n${c.redirectUri}\n(Extension ID: ${c.extensionId})`,
  }),
  invalid_client: (c) => ({
    title: 'OAuth client ID is invalid or of the wrong type.',
    hint: `Use a Web application client with redirect URI:\n${c.redirectUri}`,
  }),
  access_denied: () => ({
    title: 'Google blocked the sign-in.',
    hint:
      'The app may be in Testing mode and your account is not a test user.\n' +
      '→ OAuth consent screen → Test users → add your Google email, or publish the app.',
  }),
  oauth_disabled: () => ({
    title: 'OAuth is disabled for this client.',
    hint: 'Check the OAuth consent screen / client ID in Google Cloud.',
  }),
  cancelled: () => ({
    title: 'Google sign-in was cancelled or the window was blocked.',
    hint: 'Click Connect again and allow access.',
  }),
  user_gesture: () => ({
    title: 'This needs a direct user action.',
    hint: 'Open the full Dashboard tab → Settings → Sync → Connect.',
  }),
  auth_failed: (_c, i) => ({ title: 'Google sign-in failed.', hint: i.detail }),
  needs_reauth: () => ({
    title: 'Your Google session has expired.',
    hint: 'Click "Sign in again" to resume syncing. Local data is safe.',
  }),
  api_disabled: () => ({
    title: 'Google Drive API is not enabled for the project.',
    hint: 'Google Cloud → APIs & Services → Library → enable "Google Drive API", wait a minute, retry.',
  }),
  insufficient_scope: () => ({
    title: 'The token lacks Drive App Data permission.',
    hint: 'Disconnect → Connect again and grant all permissions.',
  }),
  rate_limited: () => ({
    title: 'Google Drive is rate limiting (429).',
    hint: 'The extension will retry in a few minutes.',
  }),
  server: (_c, i) => ({
    title: `Google Drive server error (${i.status ?? '5xx'}).`,
    hint: 'The extension will retry in a few minutes.',
  }),
  network: () => ({
    title: 'Network error talking to Google Drive.',
    hint: 'Local data is safe. The extension will retry.',
  }),
  offline: () => ({ title: 'You are offline — sync postponed.' }),
  corrupt_remote: (_c, i) => ({
    title: 'The sync file on Drive is damaged — local data was kept unchanged.',
    hint: `${i.detail ?? ''}\nYou can use "Delete Drive data" (Advanced) to recreate it from this device.`.trim(),
  }),
  schema_too_new: () => ({
    title: 'The sync file was written by a newer version of the extension.',
    hint: 'Update Bookmark Manager on this device. Nothing was overwritten.',
  }),
  conflict: () => ({
    title: 'Another device was writing at the same time.',
    hint: 'The extension will retry; or click Sync now.',
  }),
  http: (_c, i) => ({ title: `Google Drive API error (${i.status ?? '?'})`, hint: i.detail }),
  unknown: (_c, i) => ({ title: 'Google Drive sync failed.', hint: i.detail }),
};

export function formatDriveError(
  info: DriveErrorInfo,
  locale: DriveLocale,
  ctx: DriveErrorContext
): DriveErrorText {
  const table = locale === 'vi' ? VI : EN;
  const build = table[info.code] ?? table.unknown;
  return build(ctx, info);
}

/** "2 phút trước" / "2 minutes ago" — falls back to absolute date after a week. */
export function formatRelativeTime(ts: number, locale: DriveLocale, now = Date.now()): string {
  const diffSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(diffSec);
  const tag = locale === 'vi' ? 'vi-VN' : 'en-US';
  if (abs < 45) return locale === 'vi' ? 'vừa xong' : 'just now';
  try {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 7 * 86_400) return rtf.format(Math.round(diffSec / 86_400), 'day');
  } catch {
    // fall through
  }
  return formatAbsoluteTime(ts, locale);
}

export function formatAbsoluteTime(ts: number, locale: DriveLocale): string {
  try {
    return new Date(ts).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}
