import { pb } from './pocketbase';

const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly details: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function buildApiHeaders(init?: HeadersInit, token = pb.authStore.token): Headers {
  const headers = new Headers(init);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export function apiBaseUrl(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (configuredApiUrl || origin).replace(/\/$/, '');
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const token = pb.authStore.token;
  const response = await fetch(`${apiBaseUrl()}${normalizedPath}`, {
    ...init,
    headers: buildApiHeaders(init?.headers, token),
  });
  if (response.status === 401 && token) pb.authStore.clear();
  return response;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (payload && typeof payload === 'object') {
    const record = payload as { code?: unknown; message?: unknown; data?: unknown };
    return new ApiError(
      typeof record.message === 'string' ? record.message : response.statusText || 'Request failed',
      response.status,
      typeof record.code === 'number' ? record.code : undefined,
      record.data,
    );
  }

  return new ApiError(response.statusText || 'Request failed', response.status, undefined, undefined);
}
