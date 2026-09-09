CREATE TABLE jobs (
    id              UUID PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'queued',
    file_name       TEXT,
    parameters      JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress        INTEGER NOT NULL DEFAULT 0,
    tiles_done      BIGINT,
    tiles_total     BIGINT,
    error           TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    CONSTRAINT chk_jobs_status CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
    CONSTRAINT chk_jobs_progress CHECK (progress BETWEEN 0 AND 100)
);

CREATE INDEX idx_jobs_user_created ON jobs(user_id, created_at DESC);
CREATE INDEX idx_jobs_active ON jobs(status, updated_at) WHERE status IN ('queued', 'processing');
