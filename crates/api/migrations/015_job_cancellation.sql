ALTER TABLE jobs DROP CONSTRAINT chk_jobs_status;
ALTER TABLE jobs ADD CONSTRAINT chk_jobs_status
    CHECK (status IN ('queued', 'processing', 'complete', 'failed', 'cancelled'));
ALTER TABLE jobs ADD COLUMN reservation_released BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN cancelled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION release_job_storage_reservation(p_job_id UUID)
RETURNS VOID AS $$
DECLARE
    v_user_id UUID;
    v_bytes BIGINT;
BEGIN
    UPDATE jobs
       SET reservation_released = true
     WHERE id = p_job_id AND reservation_released = false
     RETURNING user_id, COALESCE((payload->>'reserved_bytes')::BIGINT, 0)
          INTO v_user_id, v_bytes;

    IF FOUND AND v_user_id IS NOT NULL AND v_bytes > 0 THEN
        UPDATE users
           SET storage_reserved_bytes = GREATEST(0, storage_reserved_bytes - v_bytes)
         WHERE id = v_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql;
