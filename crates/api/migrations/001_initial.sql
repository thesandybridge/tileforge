CREATE TABLE users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id          BIGINT UNIQUE NOT NULL,
    username           TEXT NOT NULL,
    email              TEXT,
    avatar_url         TEXT,
    stripe_customer_id TEXT UNIQUE,
    plan               TEXT NOT NULL DEFAULT 'free',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tile_sets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    projection      TEXT NOT NULL DEFAULT 'flat',
    tile_size       INT NOT NULL DEFAULT 256,
    min_zoom        INT NOT NULL DEFAULT 0,
    max_zoom        INT NOT NULL,
    tile_count      INT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,
    public          BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(user_id, slug)
);

CREATE INDEX idx_tile_sets_user ON tile_sets(user_id);
CREATE INDEX idx_tile_sets_public ON tile_sets(public) WHERE public = true;
