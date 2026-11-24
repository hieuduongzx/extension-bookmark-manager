/**
 * Shared Google Drive sync module — minimal Drive v3 REST client for `appDataFolder`.
 * Plain fetch (no gapi). Retries network errors, 429 and 5xx with exponential backoff;
 * on 401 fetches a fresh token silently exactly once.
 */
import { DriveSyncError, type DriveAccount, type DriveFileMeta } from './types.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface TokenSource {
  /** Current (possibly cached) access token. */
  get(): Promise<string>;
  /** Force a silent refresh; throw DriveSyncError('needs_reauth') when impossible. */
  refresh(): Promise<string>;
}

export interface DriveClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
}

/** Operations the sync engine needs; tests can provide an in-memory fake. */
export interface DriveClient {
  listByName(name: string): Promise<DriveFileMeta[]>;
  download(fileId: string): Promise<string>;
  getVersion(fileId: string): Promise<string | null>;
  create(name: string, content: string): Promise<DriveFileMeta>;
  update(fileId: string, content: string): Promise<DriveFileMeta>;
  remove(fileId: string): Promise<void>;
  about(): Promise<DriveAccount | null>;
}

/** Turn an HTTP failure into a DriveSyncError with a stable code. */
export function mapDriveHttpError(status: number, body: string): DriveSyncError {
  const text = (body || '').slice(0, 400);
  const lower = text.toLowerCase();
  if (
    status === 403 &&
    (lower.includes('accessnotconfigured') ||
      lower.includes('has not been used') ||
      lower.includes('is disabled') ||
      lower.includes('service_disabled'))
  ) {
    return new DriveSyncError('api_disabled', `Drive API disabled (${status})`, { status, detail: text });
  }
  if (status === 403 && (lower.includes('insufficient') || lower.includes('access_denied'))) {
    return new DriveSyncError('insufficient_scope', `Insufficient Drive scope (${status})`, { status, detail: text });
  }
  if (status === 429 || (status === 403 && (lower.includes('ratelimit') || lower.includes('quota')))) {
    return new DriveSyncError('rate_limited', `Drive rate limit (${status})`, { status, detail: text });
  }
  if (status === 401) {
    return new DriveSyncError('needs_reauth', 'Google session expired (401)', { status, detail: text });
  }
  if (status >= 500) {
    return new DriveSyncError('server', `Drive server error (${status})`, { status, detail: text });
  }
  return new DriveSyncError('http', `Drive API error (${status})`, { status, detail: text || 'no body' });
}

export function createDriveClient(tokens: TokenSource, opts: DriveClientOptions = {}): DriveClient {
  const doFetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 700;

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    let token = await tokens.get();
    let refreshed = false;
    let lastNetworkError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const headers = new Headers(init.headers ?? {});
      headers.set('Authorization', `Bearer ${token}`);
      let res: Response;
      try {
        res = await doFetch(url, { ...init, headers });
      } catch (err) {
        lastNetworkError = err;
        if (attempt < maxAttempts) {
          await sleep(baseDelay * 2 ** (attempt - 1));
          continue;
        }
        throw new DriveSyncError('network', 'Network error talking to Google Drive.', {
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await tokens.refresh(); // throws needs_reauth when silent refresh fails
        attempt--; // a token refresh is not a failed attempt
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : baseDelay * 2 ** attempt
        );
        continue;
      }
      return res;
    }
    throw new DriveSyncError('network', 'Could not reach Google Drive.', {
      detail: lastNetworkError instanceof Error ? lastNetworkError.message : undefined,
    });
  }

  async function ensureOk(res: Response): Promise<Response> {
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    throw mapDriveHttpError(res.status, body);
  }

  return {
    async listByName(name) {
      const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
      const url =
        `${DRIVE_API}/files?spaces=appDataFolder&q=${q}` +
        `&orderBy=createdTime&fields=files(id,name,version,modifiedTime,createdTime)&pageSize=10`;
      const res = await ensureOk(await request(url));
      const data = (await res.json()) as { files?: DriveFileMeta[] };
      return Array.isArray(data.files) ? data.files.filter((f) => f && typeof f.id === 'string') : [];
    },

    async download(fileId) {
      const res = await ensureOk(await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`));
      return res.text();
    },

    async getVersion(fileId) {
      const res = await ensureOk(
        await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=version`)
      );
      const data = (await res.json()) as { version?: string };
      return typeof data.version === 'string' ? data.version : null;
    },

    async create(name, content) {
      const boundary = `drivesync_${Date.now().toString(36)}`;
      const metadata = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n` +
        `--${boundary}--`;
      const res = await ensureOk(
        await request(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,version`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        })
      );
      const data = (await res.json()) as DriveFileMeta;
      if (!data?.id) throw new DriveSyncError('http', 'Drive create returned no file id');
      return data;
    },

    async update(fileId, content) {
      const res = await ensureOk(
        await request(
          `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,version`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: content,
          }
        )
      );
      return (await res.json()) as DriveFileMeta;
    },

    async remove(fileId) {
      const res = await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      if (res.status === 404) return;
      await ensureOk(res);
    },

    async about() {
      try {
        const res = await request(`${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink)`);
        if (!res.ok) return null;
        const data = (await res.json()) as {
          user?: { displayName?: string; emailAddress?: string; photoLink?: string };
        };
        if (!data.user) return null;
        return {
          displayName: data.user.displayName,
          email: data.user.emailAddress,
          photoUrl: data.user.photoLink,
        };
      } catch (err) {
        if (err instanceof DriveSyncError && err.code === 'needs_reauth') throw err;
        return null;
      }
    },
  };
}
