-- Marketing site registrations. One table for waitlist and contact.
-- The public site connects as monytix_api and may only insert.

BEGIN;

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE marketing.waitlist_registration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('waitlist', 'contact')),
  interest text CHECK (interest IN ('personal', 'business', 'both')),
  full_name text NOT NULL,
  email text NOT NULL,
  country text,
  business_name text,
  message text,
  consent boolean NOT NULL,
  source_page text NOT NULL,
  CONSTRAINT waitlist_interest_required CHECK (kind <> 'waitlist' OR interest IS NOT NULL),
  CONSTRAINT waitlist_consent_required CHECK (consent)
);

CREATE INDEX waitlist_registration_created_idx
  ON marketing.waitlist_registration (created_at DESC);

GRANT USAGE ON SCHEMA marketing TO monytix_api;
GRANT INSERT ON marketing.waitlist_registration TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'MARKETING-WAITLIST',
    'Marketing waitlist and contact registrations',
    'site-v0.1',
    'marketing-waitlist-registration',
    'The public site may insert a registration. It cannot read or update the table.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
