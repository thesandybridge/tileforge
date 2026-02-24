-- Fix reserve_storage: v_success was BOOLEAN but GET DIAGNOSTICS ROW_COUNT returns INTEGER
-- Postgres does not allow `boolean > integer` comparison

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
