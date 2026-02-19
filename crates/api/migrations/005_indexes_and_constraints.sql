-- Index for single-slug lookups (get_tileset queries by slug alone)
CREATE INDEX IF NOT EXISTS idx_tile_sets_slug ON tile_sets(slug);

-- Enforce valid plan values
ALTER TABLE users ADD CONSTRAINT chk_users_plan CHECK (plan IN ('free', 'pro'));
