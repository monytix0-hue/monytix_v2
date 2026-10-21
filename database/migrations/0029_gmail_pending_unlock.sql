-- Locked Gmail statements the phone can open with a one-time password.
-- The password is never stored.

BEGIN;

CREATE OR REPLACE FUNCTION ops.list_gmail_pending_unlock(
    p_actor uuid,
    p_owner uuid
) RETURNS TABLE (import_id uuid, filename text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $unlock$
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT d.source_batch_id, d.original_filename
      FROM core.source_document d
      JOIN LATERAL (
          SELECT er.status, er.reason_codes
            FROM core.extraction_run er
           WHERE er.source_document_id = d.source_document_id
           ORDER BY er.run_no DESC
           LIMIT 1
      ) latest ON true
     WHERE d.owner_id = p_owner
       AND d.status = 'AVAILABLE'
       AND 'SCAN_CLEAN' = ANY (d.reason_codes)
       AND coalesce(d.metadata->>'sealed', 'false') = 'true'
       AND d.metadata #>> '{source_metadata,channel}' = 'gmail'
       AND latest.status = 'FAILED'
       AND latest.reason_codes = ARRAY['PASSWORD_REJECTED']::text[]
     ORDER BY d.received_at DESC;
END;
$unlock$;

REVOKE ALL ON FUNCTION ops.list_gmail_pending_unlock(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.list_gmail_pending_unlock(uuid, uuid) TO monytix_api;

COMMIT;
