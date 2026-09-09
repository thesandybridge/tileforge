ALTER TABLE tile_sets
    ADD COLUMN tile_format TEXT NOT NULL DEFAULT 'png',
    ADD COLUMN tile_quality SMALLINT NOT NULL DEFAULT 85;

ALTER TABLE tile_sets
    ADD CONSTRAINT tile_sets_format_check CHECK (tile_format IN ('png', 'jpeg', 'webp')),
    ADD CONSTRAINT tile_sets_quality_check CHECK (tile_quality BETWEEN 1 AND 100);
