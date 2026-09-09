ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT 'Default';
DROP INDEX idx_api_keys_user_active;
CREATE INDEX idx_api_keys_user_active ON api_keys(user_id, created_at DESC) WHERE revoked_at IS NULL;
