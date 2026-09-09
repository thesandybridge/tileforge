ALTER TABLE jobs
    ADD COLUMN idempotency_key TEXT,
    ADD COLUMN payload JSONB;

CREATE UNIQUE INDEX idx_jobs_user_idempotency
    ON jobs(user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
