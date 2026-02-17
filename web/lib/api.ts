const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

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
  user_id: string;
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

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listTileSets(userId?: string): Promise<TileSet[]> {
  const params = new URLSearchParams();
  if (userId) params.set("user_id", userId);
  const res = await fetch(`${API_URL}/api/tilesets?${params}`);
  return handleResponse<TileSet[]>(res);
}

export async function getTileSet(slug: string): Promise<TileSet> {
  const res = await fetch(`${API_URL}/api/tilesets/${encodeURIComponent(slug)}`);
  return handleResponse<TileSet>(res);
}

export async function createTileSet(input: CreateTileSetInput): Promise<TileSet> {
  const res = await fetch(`${API_URL}/api/tilesets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<TileSet>(res);
}

export async function updateTileSet(slug: string, input: UpdateTileSetInput): Promise<TileSet> {
  const res = await fetch(`${API_URL}/api/tilesets/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<TileSet>(res);
}

export async function deleteTileSet(slug: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tilesets/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
}
