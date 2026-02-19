-- Add denormalized storage_used_bytes column to users table
-- This avoids expensive SUM queries on every Pro user upload

ALTER TABLE users ADD COLUMN storage_used_bytes BIGINT NOT NULL DEFAULT 0;

-- Initialize existing values
UPDATE users u
SET storage_used_bytes = COALESCE(
    (SELECT SUM(size_bytes) FROM tile_sets WHERE user_id = u.id),
    0
);

-- Create trigger function to maintain storage_used_bytes
CREATE OR REPLACE FUNCTION update_user_storage_used() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users SET storage_used_bytes = storage_used_bytes + NEW.size_bytes
        WHERE id = NEW.user_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users SET storage_used_bytes = storage_used_bytes - OLD.size_bytes
        WHERE id = OLD.user_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND OLD.size_bytes != NEW.size_bytes THEN
        UPDATE users SET storage_used_bytes = storage_used_bytes - OLD.size_bytes + NEW.size_bytes
        WHERE id = NEW.user_id;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers on tile_sets
CREATE TRIGGER trg_tile_sets_storage_insert
    AFTER INSERT ON tile_sets
    FOR EACH ROW EXECUTE FUNCTION update_user_storage_used();

CREATE TRIGGER trg_tile_sets_storage_delete
    AFTER DELETE ON tile_sets
    FOR EACH ROW EXECUTE FUNCTION update_user_storage_used();

CREATE TRIGGER trg_tile_sets_storage_update
    AFTER UPDATE OF size_bytes ON tile_sets
    FOR EACH ROW EXECUTE FUNCTION update_user_storage_used();
