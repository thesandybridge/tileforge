-- Add original image dimensions to tile_sets
ALTER TABLE tile_sets ADD COLUMN width  INTEGER;
ALTER TABLE tile_sets ADD COLUMN height INTEGER;
