-- M2.7 parser version metadata.
-- Replaces save_statement_extraction so worker_metadata records the adapter
-- version that was used. Does not edit migrations 0001-0010 and does not
-- remap historical dispositions.

BEGIN;

CREATE OR REPLACE FUNCTION ops.save_statement_extraction(
    p_document uuid,
    p_sha256 text,
    p_rows jsonb,
    p_terminal_reason text,
    p_adapter_version_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, ref, pg_temp
AS $save$
DECLARE
    v_owner uuid;
    v_status text;
    v_reasons text[];
    v_meta jsonb;
    v_hash text;
    v_adapter uuid;
    v_parser_version text;
    v_existing uuid;
    v_run uuid;
    v_run_no integer;
    v_run_status text;
    v_row jsonb;
    v_seq integer := 0;
    v_parsed integer := 0;
    v_partial integer := 0;
    v_reference text;
    v_direction text;
    v_amount text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-extract:' || p_document::text, 0));
    SELECT owner_id, status, reason_codes, metadata, content_hash
      INTO v_owner, v_status, v_reasons, v_meta, v_hash
      FROM core.source_document
     WHERE source_document_id = p_document
     FOR UPDATE;
    IF v_status IS DISTINCT FROM 'AVAILABLE' OR NOT ('SCAN_CLEAN' = ANY (COALESCE(v_reasons, ARRAY[]::text[])))
       OR coalesce(v_meta->>'sealed', 'false') <> 'true' THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;
    IF p_terminal_reason IS DISTINCT FROM 'OBJECT_TAMPERED' AND v_hash IS DISTINCT FROM p_sha256 THEN
        RETURN jsonb_build_object('outcome', 'tampered');
    END IF;
    v_adapter := COALESCE(p_adapter_version_id, (
        SELECT adapter_version_id FROM ref.adapter_registry
         WHERE adapter_id = 'parser-v4' AND adapter_version = 'v4'
    ));
    SELECT adapter_version INTO v_parser_version
      FROM ref.adapter_registry
     WHERE adapter_version_id = v_adapter;
    SELECT extraction_run_id INTO v_existing
      FROM core.extraction_run
     WHERE source_document_id = p_document AND adapter_version_id = v_adapter;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'replay', 'extraction_run_id', v_existing, 'parser_version', v_parser_version);
    END IF;
    SELECT COALESCE(max(run_no), 0) + 1 INTO v_run_no
      FROM core.extraction_run WHERE source_document_id = p_document;
    IF p_terminal_reason IS NOT NULL THEN
        v_run_status := 'FAILED';
    ELSIF jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) = 0 THEN
        v_run_status := 'FAILED';
    ELSE
        SELECT count(*) FILTER (WHERE value->>'parse_status' = 'PARSED'),
               count(*) FILTER (WHERE value->>'parse_status' IS DISTINCT FROM 'PARSED')
          INTO v_parsed, v_partial
          FROM jsonb_array_elements(p_rows);
        v_run_status := CASE WHEN v_partial = 0 THEN 'COMPLETED' ELSE 'PARTIAL' END;
    END IF;
    INSERT INTO core.extraction_run (
        source_document_id, adapter_version_id, run_no, status, run_reason, completed_at, reason_codes, worker_metadata
    ) VALUES (
        p_document, v_adapter, v_run_no, v_run_status,
        CASE WHEN v_run_no = 1 THEN 'INITIAL' ELSE 'ADAPTER_UPGRADE' END,
        clock_timestamp(),
        CASE WHEN p_terminal_reason IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_terminal_reason] END,
        jsonb_build_object('parser_version', v_parser_version)
    ) RETURNING extraction_run_id INTO v_run;
    IF p_terminal_reason IS NULL THEN
        FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
        LOOP
            v_seq := v_seq + 1;
            v_direction := v_row->>'direction';
            v_amount := v_row->>'amount';
            v_reference := COALESCE(v_row->'fields'->>'upi_rrn', v_row->'fields'->>'imps_rrn', v_row->'fields'->>'neft_utr', v_row->'fields'->>'internal_ref');
            INSERT INTO core.source_record (
                extraction_run_id, extraction_sequence, source_sequence,
                raw_record_payload, raw_description, raw_transaction_date, raw_amount, raw_debit, raw_credit, raw_reference,
                record_status, reason_codes
            ) VALUES (
                v_run, v_seq, v_seq::text,
                v_row, v_row->>'description', v_row->>'txn_date', v_amount,
                CASE WHEN v_direction IN ('OUT', 'REV', 'D') THEN v_amount ELSE NULL END,
                CASE WHEN v_direction IN ('IN', 'C') THEN v_amount ELSE NULL END,
                NULLIF(v_reference, ''),
                CASE v_row->>'parse_status'
                    WHEN 'PARSED' THEN 'TRANSACTION_CANDIDATE'
                    WHEN 'UNPARSED' THEN 'EXTRACTION_REJECTED'
                    ELSE 'EXTRACTION_PARTIAL'
                END,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row->'parse_error_reasons', '[]'::jsonb)))
            );
        END LOOP;
    END IF;
    RETURN jsonb_build_object(
        'outcome', 'created', 'extraction_run_id', v_run, 'status', v_run_status,
        'row_count', v_seq, 'parser_version', v_parser_version
    );
END;
$save$;

REVOKE ALL ON FUNCTION ops.save_statement_extraction(uuid, text, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.save_statement_extraction(uuid, text, jsonb, text, uuid) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-7-PARSER-VERSION',
    'Record the adapter version used by an extraction run',
    'D10 v1.2 FINAL FREEZE',
    'M2.7-v1',
    'worker_metadata.parser_version comes from ref.adapter_registry. Historical dispositions are not remapped.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
