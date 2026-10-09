import type { ApiError } from '@opsvera/shared';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/**
 * The access token lives in memory only.
 *
 * Not localStorage: a token readable by any script on the page is a token an
 * XSS can exfiltrate. The refresh token is in an httpOnly cookie the page
 * cannot read, so a reload recovers the session through `/auth/refresh`.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.message ?? 'Something went wrong.');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code ?? 'INTERNAL_ERROR';
    this.details = body.details;
  }

  /** Field-level messages, for feeding straight into a form. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const issue of this.details as Array<{ path?: string; message?: string }>) {
      if (issue.path && issue.message) out[issue.path] = issue.message;
    }
    return out;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Internal: prevents a refresh loop. */
  skipRefresh?: boolean;
}

/** Callback the auth provider registers so a failed refresh signs the user out. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/**
 * A single in-flight refresh shared by every 401 that arrives at once —
 * otherwise a page with six parallel queries would fire six refreshes and
 * rotate the token out from under itself.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all see this result.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, skipRefresh, headers, ...rest } = options;

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: {
      // A FormData body sets its own multipart boundary; forcing a JSON
      // content type on it would break the upload.
      ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  // An expired access token is routine — refresh once and replay.
  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, skipRefresh: true });
    }
    setAccessToken(null);
    onSessionExpired?.();
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiRequestError(response.status, payload as Partial<ApiError>);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    apiFetch<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  /** Fetches a file with the bearer token (a plain <img src> or <a href> cannot send it). */
  blob: async (path: string): Promise<Blob> => {
    const fetchOnce = () =>
      fetch(`${BASE_URL}${path}`, {
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
    let response = await fetchOnce();
    if (response.status === 401 && (await refreshAccessToken())) response = await fetchOnce();
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as Partial<ApiError>;
      throw new ApiRequestError(response.status, payload);
    }
    return response.blob();
  },
  /** Fetches a stored file and hands it to the browser as a download. */
  download: async (path: string, fileName: string) => {
    const url = URL.createObjectURL(await api.blob(path));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  },
  /** Multipart upload of a single file under the field name `file`. */
  upload: <T>(path: string, file: File, query?: RequestOptions['query']) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<T>(path, { method: 'POST', body: form, query });
  },
};
