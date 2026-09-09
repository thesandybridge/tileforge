ALTER TABLE api_keys
    ADD COLUMN scopes TEXT[] NOT NULL DEFAULT ARRAY['read', 'process'],
    ADD COLUMN last_used_at TIMESTAMPTZ,
    ADD COLUMN device_info JSONB;

ALTER TABLE api_keys ADD CONSTRAINT chk_api_key_scopes
    CHECK (scopes <@ ARRAY['read', 'process', 'manage']::TEXT[] AND cardinality(scopes) > 0);
