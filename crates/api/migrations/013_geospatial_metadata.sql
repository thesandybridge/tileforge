ALTER TABLE tile_sets
    ADD COLUMN source_epsg INTEGER,
    ADD COLUMN source_bounds DOUBLE PRECISION[];

ALTER TABLE tile_sets
    ADD CONSTRAINT chk_tile_sets_source_bounds
    CHECK (source_bounds IS NULL OR array_length(source_bounds, 1) = 4);
