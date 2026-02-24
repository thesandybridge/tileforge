-- Add storage_reserved_bytes to prevent TOCTOU race on quota check
-- Reserved bytes are claimed when a job is enqueued and released when it completes

ALTER TABLE users ADD COLUMN storage_reserved_bytes BIGINT NOT NULL DEFAULT 0;

-- Create function for atomic reservation
CREATE OR REPLACE FUNCTION reserve_storage(
    p_user_id UUID,
    p_bytes BIGINT,
    p_quota BIGINT
) RETURNS BOOLEAN AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    UPDATE users
    SET storage_reserved_bytes = storage_reserved_bytes + p_bytes
    WHERE id = p_user_id
      AND storage_used_bytes + storage_reserved_bytes + p_bytes <= p_quota;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Create function to release reservation (called after job completes or fails)
CREATE OR REPLACE FUNCTION release_storage_reservation(
    p_user_id UUID,
    p_bytes BIGINT
) RETURNS VOID AS $$
BEGIN
    UPDATE users
    SET storage_reserved_bytes = GREATEST(0, storage_reserved_bytes - p_bytes)
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
