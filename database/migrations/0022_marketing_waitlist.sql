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

COMMIT;
