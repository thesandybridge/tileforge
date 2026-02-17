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

export async function listTileSets(userId?: string, token?: string): Promise<TileSet[]> {
  const params = new URLSearchParams();
  if (userId) params.set("user_id", userId);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/tilesets?${params}`, { headers });
  return handleResponse<TileSet[]>(res);
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

export interface CurrentUser {
  id: string;
  plan: string;
}

export async function getCurrentUser(token: string): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/api/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<CurrentUser>(res);
}
