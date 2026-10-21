-- Report why an extraction run failed. Does not change how a run is saved.

BEGIN;

CREATE OR REPLACE FUNCTION ops.statement_import_summary(p_owner uuid, p_actor uuid, p_import uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $sum$
DECLARE
    v_doc_status text;
    v_run_status text;
    v_parser text;
    v_failure text;
    v_finalized text;
    v_failures integer;
    v_total integer;
    v_mapped integer;
    v_linked integer;
    v_review integer;
    v_invalid integer;
    v_ineligible integer;
    v_pending integer;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT d.status, b.metadata->>'import_finalized_at'
      INTO v_doc_status, v_finalized
      FROM core.source_document d
      JOIN core.source_batch b ON b.source_batch_id = d.source_batch_id
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner;
    IF v_doc_status IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT er.status,
           er.worker_metadata->>'parser_version',
           CASE
               WHEN er.status = 'FAILED' AND btrim(coalesce(er.reason_codes[1], '')) = '' THEN 'NO_ROWS'
               ELSE NULLIF(btrim(coalesce(er.reason_codes[1], '')), '')
           END
      INTO v_run_status, v_parser, v_failure
      FROM core.extraction_run er
      JOIN core.source_document d ON d.source_document_id = er.source_document_id
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner
     ORDER BY er.run_no DESC
     LIMIT 1;
    SELECT count(*)::int INTO v_failures
      FROM core.extraction_run er
      JOIN core.source_document d ON d.source_document_id = er.source_document_id
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner AND er.status = 'FAILED';

    WITH records AS (
        SELECT s.source_record_id, s.record_status, er.status AS run_status, er.reason_codes AS run_reasons,
               sd.status AS doc_status, sd.reason_codes AS doc_reasons, sd.metadata AS doc_meta, sd.content_hash
          FROM core.source_record s
          JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
          JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
         WHERE sd.source_batch_id = p_import AND sd.owner_id = p_owner
    ), latest AS (
        SELECT DISTINCT ON (d.source_record_id) d.source_record_id, d.outcome
          FROM core.source_record_disposition d
          JOIN records r ON r.source_record_id = d.source_record_id
         ORDER BY d.source_record_id, d.created_at DESC
    ), marked AS (
        SELECT r.source_record_id, l.outcome,
               (
                   r.run_status IN ('COMPLETED', 'PARTIAL')
                   AND NOT ('UNSUPPORTED_FILE_LAYOUT' = ANY (COALESCE(r.run_reasons, ARRAY[]::text[])))
                   AND r.doc_status = 'AVAILABLE'
                   AND 'SCAN_CLEAN' = ANY (COALESCE(r.doc_reasons, ARRAY[]::text[]))
                   AND coalesce(r.doc_meta->>'sealed', 'false') = 'true'
                   AND r.content_hash IS NOT NULL
               ) AS eligible
          FROM records r
          LEFT JOIN latest l ON l.source_record_id = r.source_record_id
    )
    SELECT count(*)::int,
           count(*) FILTER (WHERE outcome = 'MAPPED')::int,
           count(*) FILTER (WHERE outcome = 'LINKED_EXISTING')::int,
           count(*) FILTER (WHERE outcome = 'REVIEW_REQUIRED')::int,
           count(*) FILTER (WHERE outcome = 'REJECTED' OR (outcome IS NULL AND record_status = 'EXTRACTION_REJECTED'))::int,
           count(*) FILTER (WHERE outcome IS NULL AND record_status IS DISTINCT FROM 'EXTRACTION_REJECTED' AND NOT eligible)::int,
           count(*) FILTER (WHERE outcome IS NULL AND record_status IS DISTINCT FROM 'EXTRACTION_REJECTED' AND eligible)::int
      INTO v_total, v_mapped, v_linked, v_review, v_invalid, v_ineligible, v_pending
      FROM (
          SELECT m.outcome, r.record_status, m.eligible
            FROM marked m
            JOIN records r ON r.source_record_id = m.source_record_id
      ) counted;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'import_id', p_import,
        'document_status', v_doc_status,
        'extraction_status', v_run_status,
        'extraction_failure', v_failure,
        'parser_version', v_parser,
        'total_source_records', coalesce(v_total, 0),
        'mapped_count', coalesce(v_mapped, 0),
        'linked_count', coalesce(v_linked, 0),
        'review_count', coalesce(v_review, 0),
        'invalid_count', coalesce(v_invalid, 0),
        'ineligible_count', coalesce(v_ineligible, 0),
        'pending_count', coalesce(v_pending, 0),
        'processing_failures', coalesce(v_failures, 0),
        'completion_eligible', coalesce(v_review, 0) = 0 AND coalesce(v_pending, 0) = 0 AND v_run_status IN ('COMPLETED', 'PARTIAL'),
        'import_finalized_at', v_finalized
    );
END;
$sum$;

REVOKE ALL ON FUNCTION ops.statement_import_summary(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.statement_import_summary(uuid, uuid, uuid) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'EXTRACTION-FAILURE',
    'Report the extraction failure on import status',
    'D10 v1.2 FINAL FREEZE',
    'extraction-failure',
    'A failed run with no stored reason is reported as NO_ROWS. Saving a run is unchanged.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
