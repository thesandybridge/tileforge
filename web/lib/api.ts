export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface TileSet {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  projection: string;
  tile_size: number;
  min_zoom: number;
  max_zoom: number;
  tile_count: number;
  size_bytes: number;
  storage_path: string;
  public: boolean;
  created_at: string;
  width: number | null;
  height: number | null;
  source_epsg: number | null;
  source_bounds: number[] | null;
  tile_format: "png" | "jpeg" | "webp";
  tile_quality: number;
}

export type JobStatus = "queued" | "processing" | "complete" | "failed" | "cancelled";

export interface ProcessingJob {
  id: string;
  status: JobStatus;
  file_name: string | null;
  parameters: Record<string, unknown>;
  progress: number;
  tiles_done: number | null;
  tiles_total: number | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

export async function listJobs(token: string): Promise<ProcessingJob[]> {
  const res = await fetch(`${API_URL}/api/jobs?per_page=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ProcessingJob[]>(res);
}

export async function cancelJob(jobId: string, token: string): Promise<ProcessingJob> {
  const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ProcessingJob>(res);
}

export async function retryJob(jobId: string, token: string): Promise<ProcessingJob> {
  const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ProcessingJob>(res);
}

export interface CreateTileSetInput {
  name: string;
  slug: string;
  projection?: string;
  tile_size?: number;
  min_zoom?: number;
  max_zoom: number;
  tile_count: number;
  size_bytes: number;
  storage_path: string;
  public?: boolean;
  tile_format?: "png" | "jpeg" | "webp";
  tile_quality?: number;
}

export interface UpdateTileSetInput {
  name?: string;
  public?: boolean;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listTileSets(
  userId?: string,
  token?: string,
  opts?: { page?: number; perPage?: number; search?: string },
): Promise<TileSet[]> {
  const params = new URLSearchParams();
  if (userId) params.set("user_id", userId);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.perPage) params.set("per_page", String(opts.perPage));
  if (opts?.search) params.set("search", opts.search);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/tilesets?${params}`, { headers });
  return handleResponse<TileSet[]>(res);
}

export async function searchTileSets(
  query: string,
  token?: string,
): Promise<TileSet[]> {
  return listTileSets(undefined, token, { search: query, perPage: 10 });
}

export async function getTileSet(slug: string, token?: string): Promise<TileSet> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/tilesets/${encodeURIComponent(slug)}`, { headers });
  return handleResponse<TileSet>(res);
}

export async function createTileSet(input: CreateTileSetInput, token?: string): Promise<TileSet> {
  const res = await fetch(`${API_URL}/api/tilesets`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return handleResponse<TileSet>(res);
}

export async function updateTileSet(slug: string, input: UpdateTileSetInput, token?: string): Promise<TileSet> {
  const res = await fetch(`${API_URL}/api/tilesets/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return handleResponse<TileSet>(res);
}

export async function deleteTileSet(slug: string, token?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/tilesets/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
}

export async function getPmtilesUrl(slug: string, token?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(
    `${API_URL}/api/tilesets/${encodeURIComponent(slug)}/pmtiles-url`,
    { headers },
  );
  const data = await handleResponse<{ url: string }>(res);
  return data.url;
}

export interface CurrentUser {
  id: string;
  plan: string;
  storage_used: number;
  storage_quota: number;
}

export async function getCurrentUser(token: string): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/api/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<CurrentUser>(res);
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  device_info: { device_name?: string; os?: string; arch?: string } | null;
}

export interface ApiKeyCreated extends ApiKey {
  key: string;
}

export async function getApiKeys(token: string): Promise<ApiKey[]> {
  const res = await fetch(`${API_URL}/api/keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ApiKey[]>(res);
}

export async function createApiKey(token: string): Promise<ApiKeyCreated> {
  const res = await fetch(`${API_URL}/api/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<ApiKeyCreated>(res);
}

export async function createCliApiKey(token: string, device: { device_name: string; os: string; arch: string }): Promise<ApiKeyCreated> {
  const res = await fetch(`${API_URL}/api/keys/cli`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(device),
  });
  return handleResponse<ApiKeyCreated>(res);
}

export async function revokeApiKeyById(token: string, keyId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new ApiError(res.status, "Failed to revoke API key");
}

export async function revokeApiKey(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/keys`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

import type { Notification } from "@/lib/notifications";

export async function fetchNotifications(token: string): Promise<Notification[]> {
  const res = await fetch(`${API_URL}/api/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<Notification[]>(res);
}

export async function createServerNotification(
  token: string,
  body: { type: string; title: string; message?: string },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/notifications`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`);
  }
}

export async function markNotificationsRead(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/notifications/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`);
  }
}

export async function clearNotifications(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/notifications`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const b = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Linked accounts (multi-provider)
// ---------------------------------------------------------------------------

export interface LinkedAccount {
  provider: string;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  created_at: string;
}

export async function listLinkedAccounts(token: string): Promise<LinkedAccount[]> {
  const res = await fetch(`${API_URL}/api/user/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LinkedAccount[]>(res);
}

export async function unlinkAccount(provider: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/user/accounts/${encodeURIComponent(provider)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
}

export async function updateAvatar(provider: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/user/avatar`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Account deactivation
// ---------------------------------------------------------------------------

export async function deactivateAccount(): Promise<{ deactivated: boolean }> {
  const res = await fetch("/api/account/deactivate", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
