-- M2.4 parser v4 adapter.
-- Salvages the v4 format registries and classifier functions from
-- txn_parsing_framework_v4.sql. Does not create txn_fact, txn_parse_stage,
-- txn_parsed, or txn_parse_unknown_queue. Structured output is stored in
-- core.extraction_run and core.source_record.

BEGIN;

CREATE SCHEMA IF NOT EXISTS spendsense;

-- ============================================================================
-- SECTION 1 — CONFIG TABLE: txn_channel_format_registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS spendsense.txn_channel_format_registry (
    format_id           BIGSERIAL PRIMARY KEY,
    channel_type        TEXT NOT NULL,
    format_name         TEXT NOT NULL,
    detection_regex     TEXT NOT NULL,
    delimiter           TEXT NOT NULL DEFAULT '-',
    direction_rule      TEXT NOT NULL DEFAULT 'LEDGER'
                            CHECK (direction_rule IN
                                ('LEDGER','IN','OUT','REV','FROM_TOKEN')),
    direction_token_pos INT,
    skip_positions      INT[],
    prefix_strip_regex  TEXT,
    parse_confidence    NUMERIC(5,2) NOT NULL DEFAULT 0.90,
    priority            INT NOT NULL DEFAULT 100,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_channel_format UNIQUE (channel_type, format_name)
);

CREATE INDEX IF NOT EXISTS ix_cfr_channel
    ON spendsense.txn_channel_format_registry(channel_type);
CREATE INDEX IF NOT EXISTS ix_cfr_priority
    ON spendsense.txn_channel_format_registry(active, priority);

-- ============================================================================
-- SECTION 2 — CONFIG TABLE: txn_channel_field_schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS spendsense.txn_channel_field_schema (
    schema_id       BIGSERIAL PRIMARY KEY,
    channel_type    TEXT NOT NULL,
    field_name      TEXT NOT NULL,
    match_regex     TEXT NOT NULL,
    exclude_regex   TEXT,
    min_length      INT,
    max_length      INT,
    confidence      NUMERIC(5,2) NOT NULL DEFAULT 0.80,
    is_fallback     BOOLEAN NOT NULL DEFAULT FALSE,
    semantic_type   TEXT,
    priority_rank   INT NOT NULL DEFAULT 100,
    notes           TEXT,
    CONSTRAINT uq_channel_field UNIQUE (channel_type, field_name)
);

CREATE INDEX IF NOT EXISTS ix_cfs_channel
    ON spendsense.txn_channel_field_schema(channel_type);

-- ============================================================================
-- SECTION 3 — CONFIG TABLE: txn_token_noise_registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS spendsense.txn_token_noise_registry (
    noise_id      BIGSERIAL PRIMARY KEY,
    channel_type  TEXT NOT NULL,
    format_name   TEXT,
    noise_regex   TEXT NOT NULL,
    noise_type    TEXT NOT NULL DEFAULT 'GENERIC'
                      CHECK (noise_type IN ('STRUCTURAL','NOISE','GENERIC')),
    penalty_score NUMERIC(6,2) NOT NULL DEFAULT 0.50
                      CHECK (penalty_score BETWEEN 0 AND 2),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tnr_channel_active
    ON spendsense.txn_token_noise_registry(channel_type, active);
CREATE INDEX IF NOT EXISTS ix_tnr_format_active
    ON spendsense.txn_token_noise_registry(channel_type, format_name, active);

-- ============================================================================
-- SECTION 4 — CONFIG TABLE: txn_field_position_bias
-- ============================================================================

CREATE TABLE IF NOT EXISTS spendsense.txn_field_position_bias (
    bias_id           BIGSERIAL PRIMARY KEY,
    channel_type      TEXT NOT NULL,
    format_name       TEXT,
    field_name        TEXT NOT NULL,
    token_position    INT,
    position_from_end INT,
    score_bonus       NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tfpb_has_position
        CHECK (token_position IS NOT NULL OR position_from_end IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_tfpb_channel_active
    ON spendsense.txn_field_position_bias(channel_type, active);
CREATE INDEX IF NOT EXISTS ix_tfpb_format_field
    ON spendsense.txn_field_position_bias(channel_type, format_name, field_name, active);

-- ============================================================================
-- SECTION 5 — PIPELINE TABLE: txn_parse_stage
-- ============================================================================
INSERT INTO spendsense.txn_channel_format_registry (
    channel_type, format_name, detection_regex, delimiter,
    direction_rule, direction_token_pos, skip_positions,
    prefix_strip_regex, parse_confidence, priority, notes
) VALUES
-- UPI (7)
('UPI','UPI_DASH','^UPI-','-','LEDGER',NULL,ARRAY[0],NULL,0.92,10,
 'HDFC/ICICI/Axis/Kotak. 2-token=truncated. 6-token=canonical. 7-token=gateway split.'),
('UPI','UPI_P2A_SLASH','^UPI/P2A/','/',  'OUT',NULL,ARRAY[0,1],NULL,0.93,11,
 'Slash P2A. Tokens: rrn, name, bank/purpose, bank.'),
('UPI','UPI_P2M_SLASH','^UPI/P2M/','/',  'OUT',NULL,ARRAY[0,1],NULL,0.93,12,
 'Slash P2M. Tokens: rrn, merchant, purpose, bank.'),
('UPI','UPI_CRDRREV_SLASH','^UPI/(DR|CR|REV)/','/', 'FROM_TOKEN',1,ARRAY[0,1],NULL,0.92,13,
 'ICICI slash. token[1]=DR/CR/REV. VPA is masked (**prefix).'),
('UPI','UPIOUT_SLASH','^UPIOUT/','/',     'OUT',NULL,ARRAY[0],NULL,0.92,14,
 'Federal Bank. Tokens: rrn, vpa, purpose.'),
('UPI','UPI_IN_SLASH','^UPI IN/','/',     'IN', NULL,ARRAY[0],NULL,0.92,15,
 'Tokens: rrn, sender_vpa, purpose.'),
('UPI','REV_DASH','^REV-UPI-','-',        'REV',NULL,ARRAY[0,1],NULL,0.92,16,
 'Reversal. RRN=14 digits. Last token space-separates vpa from account.'),
-- IMPS (5)
('IMPS','IMPS_DASH','^IMPS-','-',         'LEDGER',NULL,ARRAY[0],NULL,0.92,20,
 'Tokens: rrn(12d), name, bank_code, masked_acct, purpose.'),
('IMPS','IMPS_P2A_SLASH','^IMPS/P2A/','/', 'LEDGER',NULL,ARRAY[0,1],NULL,0.92,21,
 'Tokens: rrn, name(trunc), bank, purpose, internal_ref.'),
('IMPS','MOB_IMPS_SLASH','(^|[\s/])(MOB|INET)-IMPS-(CR|DR)/','/','FROM_TOKEN',NULL,
 ARRAY[]::INT[],'^[0-9A-Fa-f:]+\s+\d{12}\s+',0.90,22,
 'ICICI MOB/INET IMPS. Strip timestamp/hex prefix. CR/DR in first real token.'),
('IMPS','MMT_IMPS_SLASH','^MMT/IMPS/','/', 'LEDGER',NULL,ARRAY[0,1],NULL,0.92,23,
 'Tokens: rrn, name, ifsc.'),
('IMPS','IMPS_FT_SLASH','^FT IMPS/','/',  'LEDGER',NULL,ARRAY[0],NULL,0.88,24,
 'Tokens: type, rrn, note.'),
-- NEFT (5)
('NEFT','NEFT_SLASH','^NEFT/(?!MB/|RETURN/)','/', 'LEDGER',NULL,ARRAY[0],NULL,0.93,30,
 'Canonical. Tokens: utr, name, bank, purpose.'),
('NEFT','NEFT_MB_SLASH','^NEFT/MB/','/',  'LEDGER',NULL,ARRAY[0,1],NULL,0.92,31,
 'Axis mobile. Tokens: utr(AXOMB…), name, bank, purpose.'),
('NEFT','NEFT_RETURN_SLASH','^NEFT/RETURN/','/', 'REV',NULL,ARRAY[0,1],NULL,0.92,32,
 'Tokens: utr, sender_code, name, alt_ref.'),
('NEFT','NEFT_CR_DASH','^NEFT (CR|DR)-','-', 'FROM_TOKEN',0,ARRAY[]::INT[],NULL,0.91,33,
 'token[0]=NEFT CR/DR. UTR in LAST slot.'),
('NEFT','NEFT_PLAIN_DASH','^NEFT-','-',   'LEDGER',NULL,ARRAY[0],NULL,0.90,34,
 'Tokens: utr, name, ifsc.'),
-- ACH (3)
('ACH','ACH_DR_DASH','^ACH-DR-','-',      'OUT',NULL,ARRAY[0,1],NULL,0.92,40,
 'Tokens: entity, mandate_ref, bank_ifsc_fragment.'),
('ACH','ACH_D_DASH','^ACH D-','-',        'OUT',NULL,ARRAY[0],NULL,0.90,41,
 'Legacy. Tokens: entity, mandate_ref.'),
('ACH','ACH_SLASH','^ACH/','/',            'LEDGER',NULL,ARRAY[0],NULL,0.90,42,
 'Tokens: entity, ref.'),
-- NACH (1)
('NACH','NACH_SPACE_MF','^NACH\s+[A-Z]{3,}[A-Z0-9]*\d{8}[A-Z]+',' ','OUT',NULL,
 ARRAY[]::INT[],'^[0-9A-Fa-f/\s:]+(?=NACH\s)',0.93,50,
 'MF SIP NACH. Dense fused token. Parsed by fn_parse_nach().'),
-- ATM (4)
('ATM','NWD_DASH','^NWD-','-',            'OUT',NULL,ARRAY[0],NULL,0.92,60,
 'Tokens: card(XXXXXX), atm_terminal_id, location.'),
('ATM','ATM_WDL_DASH','^ATM WDL-ATM CASH','-','OUT',NULL,ARRAY[0],NULL,0.90,61,
 'regex-extracted. atm_id and location in first real token.'),
('ATM','ATM_CASH_SLASH','^ATM-CASH/','/', 'OUT',NULL,ARRAY[0],NULL,0.90,62,
 'Tokens: location_detail, city, date(DDMMYY).'),
('ATM','ATM_INTL_SLASH','^TO INTL\. ATM MRK/','/', 'OUT',NULL,ARRAY[0],NULL,0.88,63,
 'Tokens: rrn, merchant_name.'),
-- POS (2)
('POS','POS_SPACE','^POS [0-9A-Z]{12,}',' ','OUT',NULL,ARRAY[0],NULL,0.90,70,
 'Tokens: card(XXXXXX masked), merchant_name.'),
('POS','POS_NOSPACE','^POS[0-9]{6}',' ',  'OUT',NULL,ARRAY[]::INT[],NULL,0.85,71,
 'Card+merchant concatenated. Regex-extracted.'),
-- CARD_BILLPAY (2)
('CARD_BILLPAY','IBBILLPAYDR_DASH','^IBBILLPAYDR-','-','OUT',NULL,ARRAY[0],NULL,0.92,80,
 'Tokens: biller_code(HDFC4W/HDFCCS), card+ref(space-joined).'),
('CARD_BILLPAY','IB_BILLPAY_DR_DASH','^IB BILLPAY DR-','-','OUT',NULL,ARRAY[0],NULL,0.92,81,
 'Legacy with spaces. Same structure as IBBILLPAYDR_DASH.'),
-- OTHER sub-types (8)
('OTHER','CC_PAYMENT_SPACE','^CreditCard Payment XX',' ','OUT',NULL,ARRAY[0,1,2],NULL,0.92,90,
 'Tokens: card_last4, ref_token(Ref#…).'),
('OTHER','MOB_TPFT_SLASH','^MOB/TPFT/','/', 'OUT',NULL,ARRAY[0,1],NULL,0.90,91,
 'sub_type=MOB_TRANSFER. Tokens: name, phone_or_account.'),
('OTHER','EMI_PPR','^PPR\d+_EMI_','_',    'OUT',NULL,ARRAY[]::INT[],NULL,0.90,92,
 'sub_type=EMI. Fields via regex: loan_ref, emi_date, borrower_name.'),
('OTHER','INTEREST_CREDIT_SPACE',
 '^INTEREST PAID|^INTERESTPAID|^Int\.Pd:|^SB:[0-9]','-','IN',NULL,ARRAY[]::INT[],NULL,0.90,93,
 'sub_type=INTEREST_CREDIT. Fields via regex.'),
('OTHER','CHEQUE_PAID','^CHQPAID-|^CHQ ','-','OUT',NULL,ARRAY[0],NULL,0.88,94,
 'sub_type=CHEQUE. Tokens: clearing_type, payee_name.'),
('OTHER','CASH_DEPOSIT','^BY CASH DEPOSIT','/', 'IN',NULL,ARRAY[0],NULL,0.88,95,
 'sub_type=CASH_DEPOSIT. Tokens: branch_ref, amount_ref, date, location.'),
('OTHER','BILLDESK','^[A-Z0-9]{12,}/BILLDK',' ','OUT',NULL,ARRAY[]::INT[],NULL,0.88,96,
 'sub_type=BILLDESK. token[0]=txn_hash/BILLDKbiller, token[1]=internal_ref.'),
('OTHER','POS_CC_BILL','^POS[0-9]{6}X+[0-9]{4}[A-Z]{2}HDFC',' ','OUT',NULL,
 ARRAY[]::INT[],NULL,0.88,97,
 'sub_type=CC_PAYMENT. Promote to CARD_BILLPAY in parsing.')
ON CONFLICT (channel_type, format_name) DO UPDATE
    SET detection_regex    = EXCLUDED.detection_regex,
        delimiter          = EXCLUDED.delimiter,
        direction_rule     = EXCLUDED.direction_rule,
        skip_positions     = EXCLUDED.skip_positions,
        prefix_strip_regex = EXCLUDED.prefix_strip_regex,
        parse_confidence   = EXCLUDED.parse_confidence,
        priority           = EXCLUDED.priority,
        notes              = EXCLUDED.notes,
        updated_at         = NOW();


-- ============================================================================
-- SECTION 10 — SEED: txn_channel_field_schema  (40 fields)
-- ============================================================================


INSERT INTO spendsense.txn_channel_field_schema (
    channel_type, field_name, match_regex, exclude_regex,
    min_length, max_length, confidence, is_fallback,
    semantic_type, priority_rank, notes
) VALUES
-- UPI (9)
('UPI','upi_rrn','^\d{12,14}$',NULL,12,14,0.99,FALSE,'RRN',10,
 '12 digits UPI/IMPS, 14 digits REV/HDFC.'),
('UPI','counterparty_vpa',
 '[a-z0-9._%+\-]+@[a-z]|\*\*[a-z0-9._%+\-]+@',NULL,5,60,0.98,FALSE,'VPA',20,
 'Standard VPA or masked VPA (**prefix).'),
('UPI','counterparty_name','^[A-Z][A-Z0-9 .]{2,}$',
 '(@|BANK$|PAYMENTS$|^[0-9]+$|^(GPAY|PAYTM|PHONEPE|BHIM|AIRTEL|UPI|IN|OUT|DR|CR|REV|P2A|P2M|P2P|TRF|LEDGER|PAYMENTFROMPHONE|SENT|COLLECT|UPIINT|YESPAY|IN APP|SENT USI|PAYMEN|PAYMENT)$)',
 3,40,0.82,FALSE,'NAME',40,'Alpha name. Excludes bank names, VPAs, keywords.'),
('UPI','counterparty_bank',
 '(BANK|PAYMENTS BANK|BANK LTD|BANK LIMITED)$|^(SBI|HDFC|ICICI|AXIS|KOTAK|YES|CANARA|PNB|BOB|UNION|IDFC|AIRTEL|FEDERAL|INDUS|BANDHAN|CITI|HSBC|RBL|UTIB|SBIN|CNRB|YESB0|UBIN|MAHB|INDB)([0-9A-Z]*)$',
 NULL,2,40,0.95,FALSE,'BANK',30,'Bank name or IFSC-style code.'),
('UPI','counterparty_ifsc','^[A-Z]{4}0[A-Z0-9]{6}$',NULL,11,11,0.99,FALSE,'IFSC',25,
 'Standard 11-char IFSC.'),
('UPI','txn_type_code','^(P2A|P2M|P2P|DR|CR|REV)$',NULL,2,3,0.99,FALSE,'TYPE_CODE',50,
 'UPI transaction type indicator.'),
('UPI','gateway_name',
 '^(GPAY|PAYTM|PHONEPE|BHIM|AIRTEL|YESPAY|AMAZONPAY|MOBIKWIK|FREECHARGE)$',
 '@',3,15,0.97,FALSE,'GATEWAY',45,'Standalone gateway token (no @).'),
('UPI','internal_ref','[A-F0-9]{16,}|^[A-Z]{3,4}[0-9A-F]{12,}$','^\d{12,14}$',
 10,60,0.90,FALSE,'REF',60,'Hex internal ref. Excludes RRN.'),
('UPI','purpose','.',NULL,1,80,0.50,TRUE,'PURPOSE',999,'Fallback.'),
-- IMPS (7)
('IMPS','imps_rrn','^\d{12}$',NULL,12,12,0.99,FALSE,'RRN',10,'IMPS RRN always 12 digits.'),
('IMPS','counterparty_name','^[A-Z][A-Z0-9 .]{2,}$',
 '(@|BANK$|PAYMENTS$|^[0-9]+$|^(TRF|SAVINGS|DONATION|RENT|IMPS|TRANSFER|TRANS|MAINTENANCE|OWN|AC|SELF|CUSTOMER|VENDORPA|REMITTER|HANDLOAN)$)',
 3,40,0.82,FALSE,'NAME',40,NULL),
('IMPS','counterparty_bank',
 '(BANK$|BANK LTD$|BANK LIMITED$)|^(HDFC|ICICI|ICIC|SBIN|UBIN|MAHB|CNRB|HSBC|FDRL|YESB|INDB|IDFC|UTIB|AXIS|SBI|PNB|BOB)([0-9A-Z]*)$',
 NULL,2,30,0.95,FALSE,'BANK',30,NULL),
('IMPS','counterparty_account','^X{4,}[0-9]{4,}$|^[0-9]{9,18}$','^\d{12}$',
 6,20,0.90,FALSE,'ACCOUNT',35,'Masked or raw account. Excludes RRN.'),
('IMPS','counterparty_ifsc','^[A-Z]{4}0[A-Z0-9]{6}$',NULL,11,11,0.99,FALSE,'IFSC',25,NULL),
('IMPS','internal_ref','^[0-9]{16,}$|^[A-Z]{4}[0-9]{10,}$','^\d{12}$',
 14,30,0.88,FALSE,'REF',60,NULL),
('IMPS','purpose','.',NULL,1,80,0.50,TRUE,'PURPOSE',999,'Fallback.'),
-- NEFT (5)
('NEFT','neft_utr',
 '^[A-Z]{4}[HN]\d{11,}$|^[A-Z]{4}\d{2}\d{10,}$|^[A-Z]{3,6}\d{14,}$',
 NULL,12,25,0.99,FALSE,'UTR',10,'UTR: HDFCH004…, CITIN256…, SBIN425…, AXOMB219….'),
('NEFT','counterparty_name','^[A-Z][A-Za-z0-9 .]{3,}$',
 '(BANK$|BANK LTD$|BANK LIMITED$|^[0-9]+$|^(MB|RETURN|NEFT|SELF|ATTN|INB|NULL)$)',
 4,50,0.82,FALSE,'NAME',40,NULL),
('NEFT','counterparty_bank',
 '(BANK$|BANK LTD$|BANK LIMITED$)|^(HDFC|ICICI|SBIN|CITI|YES|AXIS|IDBI|CITI0)([0-9A-Z]*)$',
 NULL,3,30,0.95,FALSE,'BANK',30,NULL),
('NEFT','counterparty_ifsc','^[A-Z]{4}0[A-Z0-9]{6}$',NULL,11,11,0.99,FALSE,'IFSC',25,NULL),
('NEFT','purpose','.',NULL,1,100,0.50,TRUE,'PURPOSE',999,'Fallback.'),
-- ACH (4)
('ACH','ach_entity','^[A-Z][A-Z0-9_ .]{2,}$','^(DR|CR|ACH|IN|OUT)$',
 3,40,0.85,FALSE,'ENTITY',70,'Biller/entity name.'),
('ACH','mandate_ref','^[A-Z0-9]{6,}$',
 '^(DR|CR|ACH|UTIB|HDFC|ICIC|SBIN|AXIS|YESB|CNRB)([0-9A-Z]*)$',
 6,30,0.85,FALSE,'MANDATE',75,'ACH mandate/run reference.'),
('ACH','counterparty_ifsc','^[A-Z]{4}0[A-Z0-9]{6}$|^[A-Z]{4}[0-9]{7,}$',
 NULL,8,20,0.90,FALSE,'IFSC',25,NULL),
('ACH','purpose','.',NULL,1,60,0.50,TRUE,'PURPOSE',999,'Fallback.'),
-- ATM (5)
('ATM','card_number','^[0-9]{6}X+[0-9]{4}$|^[0-9]{6}X{4,}[0-9]{3,4}$',
 NULL,12,20,0.99,FALSE,'CARD',20,'Masked card: 6 digits + X + 4 digits.'),
('ATM','atm_terminal_id','^[A-Z0-9]{6,10}$',
 '^(BANGALORE|HYDERABAD|MUMBAI|DELHI|CHENNAI|PUNE|KOLKATA|UJJAIN|KHAMMAM|UPI|ATM|NWD)$',
 4,12,0.85,FALSE,'REF',35,NULL),
('ATM','atm_location','^[A-Z][A-Z ]{3,}$','^(NWD|ATM|CASH|UPI|DR|CR)$',
 3,40,0.82,FALSE,'ATM_LOC',40,'City or location name.'),
('ATM','atm_txn_id','^\d{4,6}$',NULL,4,6,0.80,FALSE,'ATM_TXN',20,
 'Short numeric ATM txn id (ATM WDL format).'),
('ATM','purpose','.',NULL,1,60,0.50,TRUE,'PURPOSE',999,'Fallback.'),
-- POS (2)
('POS','card_number','^[0-9]{6}X+[0-9]{4}$',NULL,12,20,0.99,FALSE,'CARD',20,NULL),
('POS','merchant_name','^[A-Z][A-Z0-9 .]{2,}$','^(POS|UPI|DR|CR)$',
 3,50,0.80,FALSE,'NAME',40,NULL),
-- CARD_BILLPAY (3)
('CARD_BILLPAY','biller_code',
 '^HDFC(4W|CS|CC|PL|HL|LAP|GL|BL|AL|TWL)$|^[A-Z0-9]{4,12}$',
 NULL,4,15,0.90,FALSE,'ENTITY',70,'Biller product code.'),
('CARD_BILLPAY','card_ref',
 '^[0-9]{6}X+[0-9]{4}\s+[A-Z0-9]{10,}$|^[0-9]{6}X+[0-9]{4}$',
 NULL,12,40,0.92,FALSE,'CARD',25,'Masked card + txn ref.'),
('CARD_BILLPAY','internal_ref','^MB[0-9]{10,}[A-Z0-9]{2,}$',
 NULL,10,25,0.95,FALSE,'REF',60,'HDFC mobile banking ref e.g. MB07121523714T48.'),
-- OTHER (5)
('OTHER','card_last4','^\d{4}$',NULL,4,4,0.90,FALSE,'CARD',30,'Last 4 of card.'),
('OTHER','payment_ref','^Ref#[A-Z0-9]{10,}$',NULL,8,25,0.95,FALSE,'REF',60,NULL),
('OTHER','counterparty_name','^[A-Z][A-Za-z ]{3,}$',
 '^(MOB|TPFT|UPI|NACH|ACH|NEFT|IMPS)$',4,40,0.82,FALSE,'NAME',40,NULL),
('OTHER','phone_or_account','^[0-9]{10,16}$',NULL,10,16,0.88,FALSE,'ACCOUNT',35,NULL),
('OTHER','purpose','.',NULL,1,100,0.50,TRUE,'PURPOSE',999,'Fallback.')
ON CONFLICT (channel_type, field_name) DO UPDATE
    SET match_regex   = EXCLUDED.match_regex,
        exclude_regex = EXCLUDED.exclude_regex,
        min_length    = EXCLUDED.min_length,
        max_length    = EXCLUDED.max_length,
        confidence    = EXCLUDED.confidence,
        is_fallback   = EXCLUDED.is_fallback,
        semantic_type = EXCLUDED.semantic_type,
        priority_rank = EXCLUDED.priority_rank,
        notes         = EXCLUDED.notes;


-- ============================================================================
-- SECTION 11 — SEED: txn_token_noise_registry  (7 entries)
-- ============================================================================


INSERT INTO spendsense.txn_token_noise_registry
    (channel_type, format_name, noise_regex, noise_type, penalty_score, notes)
VALUES
('UPI',NULL,'^(UPI|P2A|P2M|P2P|DR|CR|REV|IN|OUT)$','STRUCTURAL',1.00,
 'UPI structural markers — never a real field value'),
('UPI',NULL,'^(IN APP|SENT USI|PAYMEN|PAYMENT|PAYMENTFROMPHONE|TRF|LEDGER|COLLECT|REQUEST|UPIINT|YESPAY)$',
 'NOISE',0.90,'UPI bank narration garbage at variable positions'),
('IMPS',NULL,'^(IMPS|P2A|P2P|TRF|TRANSFER|TRANS|OWN|SELF|AC|DR|CR)$','STRUCTURAL',0.90,
 'IMPS structural markers'),
('NEFT',NULL,'^(NEFT|MB|RETURN|SELF|ATTN|INB|NULL|DR|CR)$','STRUCTURAL',0.90,
 'NEFT structural markers'),
('ATM',NULL,'^(ATM|CASH|NWD|WDL|DR|CR)$','STRUCTURAL',0.90,'ATM structural markers'),
('CARD_BILLPAY',NULL,'^(IBBILLPAYDR|IB BILLPAY DR|BILLPAY|CARDPAY|CCPAY)$','STRUCTURAL',0.95,
 'Card billpay structural prefix tokens'),
('OTHER',NULL,'^(MOB|TPFT|FT|TRF|TRANSFER|DR|CR)$','STRUCTURAL',0.85,
 'Other channel structural tokens')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- SECTION 12 — SEED: txn_field_position_bias  (34 entries)
-- ============================================================================


INSERT INTO spendsense.txn_field_position_bias
    (channel_type, format_name, field_name, token_position, position_from_end,
     score_bonus, notes)
VALUES
-- UPI slash formats
('UPI','UPI_P2A_SLASH','upi_rrn',           1,NULL,1.50,'RRN first usable token'),
('UPI','UPI_P2A_SLASH','counterparty_name', 2,NULL,1.20,'Name follows RRN'),
('UPI','UPI_P2A_SLASH','counterparty_bank', NULL,1, 1.10,'Bank often last'),
('UPI','UPI_P2M_SLASH','upi_rrn',           1,NULL,1.50,'RRN first'),
('UPI','UPI_P2M_SLASH','counterparty_name', 2,NULL,1.25,'Merchant follows RRN'),
('UPI','UPI_P2M_SLASH','merchant_name',     2,NULL,1.25,'Merchant follows RRN'),
('UPI','UPI_P2M_SLASH','counterparty_bank', NULL,1, 1.10,'Bank often last'),
('UPI','UPI_CRDRREV_SLASH','upi_rrn',       2,NULL,1.40,'RRN after DR/CR/REV'),
('UPI','UPI_CRDRREV_SLASH','counterparty_vpa',3,NULL,1.10,'Masked VPA after RRN'),
('UPI','UPIOUT_SLASH','upi_rrn',            1,NULL,1.50,'RRN first'),
('UPI','UPIOUT_SLASH','counterparty_vpa',   2,NULL,1.15,'VPA next'),
('UPI','UPI_IN_SLASH','upi_rrn',            1,NULL,1.50,'RRN first'),
('UPI','UPI_IN_SLASH','counterparty_vpa',   2,NULL,1.15,'Sender VPA next'),
('UPI','REV_DASH','upi_rrn',                1,NULL,1.40,'RRN early in reversal'),
('UPI','REV_DASH','counterparty_vpa',       NULL,2, 1.00,'VPA near tail'),
-- IMPS
('IMPS','IMPS_DASH','imps_rrn',             1,NULL,1.40,'RRN first'),
('IMPS','IMPS_DASH','counterparty_name',    2,NULL,1.10,'Name after RRN'),
('IMPS','IMPS_DASH','counterparty_bank',    3,NULL,0.90,'Bank third'),
('IMPS','IMPS_P2A_SLASH','imps_rrn',        1,NULL,1.40,'RRN first'),
('IMPS','IMPS_P2A_SLASH','counterparty_name',2,NULL,1.10,'Name second'),
('IMPS','IMPS_P2A_SLASH','counterparty_bank',3,NULL,0.90,'Bank third'),
('IMPS','MMT_IMPS_SLASH','imps_rrn',        1,NULL,1.40,'RRN first'),
('IMPS','MMT_IMPS_SLASH','counterparty_name',2,NULL,1.10,'Name second'),
('IMPS','MMT_IMPS_SLASH','counterparty_ifsc',NULL,1,0.95,'IFSC often last'),
-- NEFT
('NEFT','NEFT_SLASH','neft_utr',            1,NULL,1.40,'UTR first in canonical slash'),
('NEFT','NEFT_SLASH','counterparty_name',   2,NULL,0.80,'Name second'),
('NEFT','NEFT_SLASH','counterparty_bank',   NULL,1, 0.90,'Bank often last'),
('NEFT','NEFT_MB_SLASH','neft_utr',         1,NULL,1.30,'UTR first after MB skip'),
('NEFT','NEFT_CR_DASH','neft_utr',          NULL,1, 1.20,'UTR always last in NEFT CR dash'),
-- ATM
('ATM','ATM_WDL_DASH','atm_txn_id',         1,NULL,1.00,'Short numeric txn id early'),
('ATM','ATM_WDL_DASH','atm_location',        NULL,1, 1.00,'Location last'),
('ATM','NWD_DASH','card_number',             1,NULL,1.30,'Card first after NWD'),
('ATM','NWD_DASH','atm_terminal_id',         2,NULL,0.90,'Terminal second'),
('ATM','NWD_DASH','atm_location',            NULL,1, 1.00,'Location last')
ON CONFLICT DO NOTHING;



-- ============================================================================
-- SECTION 13 — HELPER FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION spendsense.fn_norm_desc(p_desc TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT UPPER(regexp_replace(regexp_replace(trim(COALESCE(p_desc,'')),
        '[[:cntrl:]]',' ','g'), '\s+',' ','g'));
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_array_len(p_arr TEXT[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(array_length(p_arr,1), 0);
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_digits_only(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(regexp_replace(COALESCE(p_text,''), '[^0-9]','','g'), '');
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_txn_shape_signature(p_desc TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(UPPER(COALESCE(p_desc,'')),
            '[A-Z0-9._%+-]+@[A-Z0-9.-]+','VPA','g'),
            '[0-9]{8,}','NUM','g'),
            '[A-Z]{4}[0-9A-Z]{6,}','BANKCODE','g'),
            '\b[0-9]+\b','NUM','g'),
            '\s+',' ','g');
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_extract_internal_ref(
    p_norm_desc       TEXT,
    p_internal_ref_regex TEXT  -- from registry; NULL = use global fallback
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_result TEXT;
BEGIN
    -- Pattern-specific regex (IS-03: registry-driven, no hardcoded banks)
    IF p_internal_ref_regex IS NOT NULL THEN
        v_result := (regexp_match(p_norm_desc, p_internal_ref_regex))[1];
        IF v_result IS NOT NULL THEN RETURN v_result; END IF;
    END IF;

    -- Global fallback 1: IBL-prefixed references (ibl bank format)
    v_result := (regexp_match(p_norm_desc, '(IBL[0-9A-F]+)'))[1];
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;

    -- Global fallback 2: double-slash internal ref (generic — no bank names)
    -- Matches patterns like: PREFIX//TOKEN/... where TOKEN is the ref
    v_result := (regexp_match(p_norm_desc, '//([A-Z0-9]+)(?:/|$)'))[1];
    IF v_result IS NOT NULL AND length(v_result) >= 6 THEN RETURN v_result; END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_norm_token_v31(p_token TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(
        TRIM(
            regexp_replace(
                regexp_replace(
                    UPPER(COALESCE(p_token, '')),
                    '[[:space:]]+', ' ', 'g'
                ),
                '^[^A-Z0-9@*]+|[^A-Z0-9@*]+$', '', 'g'
            )
        ),
        ''
    );
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_token_features_v31(p_token TEXT)
RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    WITH t AS (
        SELECT spendsense.fn_norm_token_v31(p_token) AS tok
    )
    SELECT jsonb_build_object(
        'token',         tok,
        'len',           COALESCE(length(tok), 0),
        'is_numeric',    COALESCE(tok ~ '^[0-9]+$', FALSE),
        -- RRN: exactly 12-14 consecutive digits (UPI/IMPS)
        'is_rrn_like',   COALESCE(tok ~ '^[0-9]{12,14}$', FALSE),
        -- UTR: alphanumeric, starts with letter(s), 12-22 chars (NEFT)
        'is_utr_like',   COALESCE(tok ~ '^[A-Z]{3,6}[0-9A-Z]{9,16}$', FALSE),
        -- VPA: local-part@bank or **masked@bank
        'is_vpa_like',   COALESCE(tok ~ '(^|\*\*)[A-Z0-9._%+\-]+@[A-Z][A-Z0-9._\-]*$', FALSE),
        -- IFSC: 4 letters + 0 + 6 alphanumeric
        'is_ifsc_like',  COALESCE(tok ~ '^[A-Z]{4}0[A-Z0-9]{6}$', FALSE),
        -- Bank: ends with BANK, PAYMENTS BANK, or is a known 4-char code
        'is_bank_like',  COALESCE(tok ~ '(BANK|PAYMENTS BANK|BANK LTD|BANK LIMITED)$'
                                   OR tok ~ '^(HDFC|ICIC|SBIN|UTIB|CNRB|YESB|AXIS|UBIN|MAHB|INDB|FDRL)([0-9A-Z]*)$',
                                  FALSE),
        -- Card: 6 digits + X-mask + 3-4 digits
        'is_card_like',  COALESCE(tok ~ '^[0-9]{6}X{4,}[0-9]{3,4}$', FALSE),
        -- Alpha name: starts with letter, mostly letters/spaces
        'is_alpha_like', COALESCE(tok ~ '^[A-Z][A-Z0-9 .&/_-]{2,}$', FALSE)
    )
    FROM t;
$$;


-- ============================================================================
-- SECTION 14 — DETECTION + DIRECTION FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION spendsense.fn_detect_format_v3(
    p_norm_desc TEXT
)
RETURNS TABLE (
    format_id           BIGINT,
    channel_type        TEXT,
    format_name         TEXT,
    delimiter           TEXT,
    direction_rule      TEXT,
    direction_token_pos INT,
    skip_positions      INT[],
    prefix_strip_regex  TEXT,
    parse_confidence    NUMERIC
)
LANGUAGE sql STABLE AS $$
    SELECT
        r.format_id,
        r.channel_type,
        r.format_name,
        r.delimiter,
        r.direction_rule,
        r.direction_token_pos,
        r.skip_positions,
        r.prefix_strip_regex,
        r.parse_confidence
    FROM spendsense.txn_channel_format_registry r
    WHERE r.active = TRUE
      AND p_norm_desc ~* r.detection_regex
    ORDER BY r.priority, r.format_id
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_derive_direction_v3(
    p_direction_rule      TEXT,
    p_direction_token_pos INT,
    p_norm_desc           TEXT,
    p_delimiter           TEXT,
    p_cr_dr               CHAR(1)
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_tokens TEXT[];
    v_tok    TEXT;
BEGIN
    CASE p_direction_rule
        WHEN 'IN'  THEN RETURN 'IN';
        WHEN 'OUT' THEN RETURN 'OUT';
        WHEN 'REV' THEN RETURN 'REV';
        WHEN 'FROM_TOKEN' THEN
            v_tokens := string_to_array(
                UPPER(TRIM(COALESCE(p_norm_desc, ''))), UPPER(p_delimiter));
            IF p_direction_token_pos IS NOT NULL
               AND array_length(v_tokens, 1) >= p_direction_token_pos + 1 THEN
                v_tok := TRIM(v_tokens[p_direction_token_pos + 1]);
                RETURN CASE
                    WHEN v_tok IN ('CR','CREDIT','IN')  THEN 'IN'
                    WHEN v_tok IN ('DR','DEBIT','OUT')  THEN 'OUT'
                    WHEN v_tok IN ('REV','REVERSAL')    THEN 'REV'
                    ELSE 'UNKNOWN'
                END;
            END IF;
            RETURN 'UNKNOWN';
        ELSE -- LEDGER
            RETURN CASE
                WHEN p_cr_dr = 'C' THEN 'IN'
                WHEN p_cr_dr = 'D' THEN 'OUT'
                ELSE 'UNKNOWN'
            END;
    END CASE;
END;
$$;


-- ============================================================================
-- SECTION 15 — CLASSIFIER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION spendsense.fn_classify_tokens(
    p_norm_desc     TEXT,
    p_channel_type  TEXT,
    p_format_name   TEXT,
    p_delimiter     TEXT,
    p_skip_pos      INT[],
    p_prefix_strip  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_desc       TEXT;
    v_raw_tokens TEXT[];
    v_result     JSONB := '{}'::JSONB;
BEGIN
    -- Strip prefix noise
    v_desc := UPPER(TRIM(COALESCE(p_norm_desc, '')));
    IF p_prefix_strip IS NOT NULL THEN
        v_desc := TRIM(regexp_replace(v_desc, p_prefix_strip, '', 'i'));
    END IF;

    v_raw_tokens := string_to_array(v_desc, UPPER(p_delimiter));

    IF COALESCE(array_length(v_raw_tokens, 1), 0) = 0 THEN
        RETURN jsonb_build_object(
            '_confidence',        0.10,
            '_tokens',            0,
            '_format',            p_format_name,
            '_classifier_version','v3.1'
        );
    END IF;

    WITH

    -- ── Step 1: tokenise and apply skip_positions ──────────────────────
    raw_tokens AS (
        SELECT
            (ordinality::INT - 1) AS raw_pos,
            spendsense.fn_norm_token_v31(token) AS token
        FROM unnest(v_raw_tokens) WITH ORDINALITY AS t(token, ordinality)
    ),
    usable_tokens AS (
        SELECT
            row_number() OVER (ORDER BY raw_pos) AS token_pos,
            raw_pos,
            token
        FROM raw_tokens
        WHERE token IS NOT NULL
          AND NOT ((raw_pos) = ANY(COALESCE(p_skip_pos, ARRAY[]::INT[])))
    ),

    -- ── Step 2: REV_DASH secondary split ──────────────────────────────
    -- Last token may be "VPA ACCOUNT" — split on first space.
    -- FIX: original RTF had ~ '\'' which is wrong. Correct: token ~ ' '
    rev_split AS (
        SELECT * FROM usable_tokens
        WHERE NOT (
            p_format_name = 'REV_DASH'
            AND token_pos = (SELECT max(token_pos) FROM usable_tokens)
            AND token ~ ' '
        )
        UNION ALL
        -- First half (VPA)
        SELECT
            u.token_pos,
            u.raw_pos,
            split_part(u.token, ' ', 1) AS token
        FROM usable_tokens u
        WHERE p_format_name = 'REV_DASH'
          AND u.token_pos = (SELECT max(token_pos) FROM usable_tokens)
          AND u.token ~ ' '
        UNION ALL
        -- Second half (account / tail)
        SELECT
            u.token_pos + 1000,
            u.raw_pos + 1000,
            NULLIF(TRIM(substring(u.token FROM position(' ' IN u.token) + 1)), '') AS token
        FROM usable_tokens u
        WHERE p_format_name = 'REV_DASH'
          AND u.token_pos = (SELECT max(token_pos) FROM usable_tokens)
          AND u.token ~ ' '
    ),
    norm_tokens AS (
        SELECT
            row_number() OVER (ORDER BY token_pos, raw_pos) AS token_pos,
            raw_pos,
            token
        FROM rev_split
        WHERE token IS NOT NULL
    ),

    -- ── Step 3: semantic features per token ───────────────────────────
    token_count AS (
        SELECT count(*)::INT AS n FROM norm_tokens
    ),
    token_features AS (
        SELECT
            t.token_pos,
            t.raw_pos,
            t.token,
            spendsense.fn_token_features_v31(t.token) AS feat
        FROM norm_tokens t
    ),

    -- ── Step 4: load field schema ──────────────────────────────────────
    field_schema AS (
        SELECT
            s.schema_id,
            s.field_name,
            s.match_regex,
            s.exclude_regex,
            s.min_length,
            s.max_length,
            s.confidence,
            s.is_fallback,
            COALESCE(s.semantic_type, 'GENERIC')  AS semantic_type,
            COALESCE(s.priority_rank, 100)         AS priority_rank
        FROM spendsense.txn_channel_field_schema s
        WHERE s.channel_type = p_channel_type
    ),
    non_fallback_fields AS (
        SELECT * FROM field_schema WHERE is_fallback = FALSE
    ),

    -- ── Step 5: pre-join noise hits ────────────────────────────────────
    noise_hits AS (
        SELECT
            t.token_pos,
            max(n.penalty_score) AS penalty_score
        FROM token_features t
        JOIN spendsense.txn_token_noise_registry n
          ON n.active       = TRUE
         AND n.channel_type = p_channel_type
         AND (n.format_name IS NULL OR n.format_name = p_format_name)
         AND t.token ~* n.noise_regex
        GROUP BY t.token_pos
    ),

    -- ── Step 6: pre-join position bonuses (FIX: was correlated subquery) ─
    position_bonuses AS (
        SELECT
            b.field_name,
            t.token_pos,
            max(b.score_bonus) AS score_bonus
        FROM token_features t
        CROSS JOIN token_count c
        JOIN spendsense.txn_field_position_bias b
          ON b.active       = TRUE
         AND b.channel_type = p_channel_type
         AND (b.format_name IS NULL OR b.format_name = p_format_name)
         AND (
               (b.token_position    IS NOT NULL AND b.token_position    = t.token_pos)
            OR (b.position_from_end IS NOT NULL AND b.position_from_end = (c.n - t.token_pos + 1))
         )
        GROUP BY b.field_name, t.token_pos
    ),

    -- ── Step 7: score every (token, field) pair ────────────────────────
    candidate_scores AS (
        SELECT
            t.token_pos,
            t.raw_pos,
            t.token,
            f.field_name,
            f.priority_rank,
            (
                -- Base: regex match score
                CASE
                    WHEN t.token ~* f.match_regex THEN f.confidence
                    ELSE 0
                END

                -- Semantic bonus
                + CASE
                    WHEN f.semantic_type = 'RRN'
                         AND COALESCE((t.feat->>'is_rrn_like')::BOOLEAN, FALSE)
                    THEN 0.80
                    WHEN f.semantic_type = 'UTR'
                         AND COALESCE((t.feat->>'is_utr_like')::BOOLEAN, FALSE)
                    THEN 0.80
                    WHEN f.semantic_type = 'VPA'
                         AND COALESCE((t.feat->>'is_vpa_like')::BOOLEAN, FALSE)
                    THEN 0.90
                    WHEN f.semantic_type = 'IFSC'
                         AND COALESCE((t.feat->>'is_ifsc_like')::BOOLEAN, FALSE)
                    THEN 0.90
                    WHEN f.semantic_type = 'BANK'
                         AND COALESCE((t.feat->>'is_bank_like')::BOOLEAN, FALSE)
                    THEN 0.75
                    WHEN f.semantic_type = 'CARD'
                         AND COALESCE((t.feat->>'is_card_like')::BOOLEAN, FALSE)
                    THEN 0.80
                    WHEN f.semantic_type = 'NAME'
                         AND COALESCE((t.feat->>'is_alpha_like')::BOOLEAN, FALSE)
                    THEN 0.30
                    WHEN f.semantic_type IN ('RRN','UTR','REF')
                         AND COALESCE((t.feat->>'is_numeric')::BOOLEAN, FALSE)
                         AND length(t.token) >= 8
                    THEN 0.15
                    ELSE 0
                END

                -- Position bonus (pre-joined — no correlated subquery)
                + COALESCE(pb.score_bonus, 0)

                -- Noise penalty
                - COALESCE(n.penalty_score, 0)

                -- Cross-semantic mismatch penalty
                - CASE
                    WHEN f.semantic_type = 'NAME'
                         AND COALESCE((t.feat->>'is_bank_like')::BOOLEAN, FALSE)
                    THEN 0.90
                    WHEN f.semantic_type = 'NAME'
                         AND COALESCE((t.feat->>'is_vpa_like')::BOOLEAN, FALSE)
                    THEN 1.00
                    WHEN f.semantic_type = 'BANK'
                         AND COALESCE((t.feat->>'is_vpa_like')::BOOLEAN, FALSE)
                    THEN 0.80
                    WHEN f.semantic_type = 'RRN'
                         AND NOT COALESCE((t.feat->>'is_rrn_like')::BOOLEAN, FALSE)
                    THEN 0.30
                    WHEN f.semantic_type = 'UTR'
                         AND NOT COALESCE((t.feat->>'is_utr_like')::BOOLEAN, FALSE)
                         AND NOT COALESCE((t.feat->>'is_rrn_like')::BOOLEAN, FALSE)
                    THEN 0.30
                    ELSE 0
                END
            )::NUMERIC(8,4) AS final_score

        FROM token_features  t
        CROSS JOIN non_fallback_fields f
        LEFT JOIN noise_hits      n  ON n.token_pos = t.token_pos
        LEFT JOIN position_bonuses pb ON pb.field_name = f.field_name
                                      AND pb.token_pos  = t.token_pos
        WHERE (f.min_length IS NULL OR length(t.token) >= f.min_length)
          AND (f.max_length IS NULL OR length(t.token) <= f.max_length)
          AND (f.exclude_regex IS NULL OR t.token !~* f.exclude_regex)
    ),
    positive_scores AS (
        SELECT * FROM candidate_scores WHERE final_score > 0
    ),

    -- ── Step 8: 1:1 assignment via window functions ────────────────────
    ranked AS (
        SELECT
            *,
            row_number() OVER (
                PARTITION BY field_name
                ORDER BY final_score DESC, priority_rank ASC,
                         token_pos ASC, length(token) DESC
            ) AS rn_field,
            row_number() OVER (
                PARTITION BY token_pos
                ORDER BY final_score DESC, priority_rank ASC,
                         length(token) DESC, field_name
            ) AS rn_token
        FROM positive_scores
    ),
    winners AS (
        SELECT token_pos, raw_pos, token, field_name, final_score, priority_rank
        FROM ranked
        WHERE rn_field = 1 AND rn_token = 1
    ),

    -- ── Step 9: unassigned tokens → purpose ───────────────────────────
    leftovers AS (
        SELECT string_agg(t.token, ' ' ORDER BY t.token_pos) AS purpose_text
        FROM token_features t
        WHERE NOT EXISTS (
            SELECT 1 FROM winners w WHERE w.token_pos = t.token_pos
        )
    ),

    -- ── Step 10: assemble output JSONB ────────────────────────────────
    assigned_map AS (
        SELECT jsonb_object_agg(field_name, token_pos) AS assigned_json
        FROM winners
    ),
    winner_payload AS (
        SELECT COALESCE(jsonb_object_agg(field_name, token), '{}'::JSONB) AS fields_json
        FROM winners
    ),
    confidence_calc AS (
        SELECT COALESCE(round(min(final_score)::NUMERIC, 2), 0.20) AS min_conf
        FROM winners
    )
    SELECT
        COALESCE(wp.fields_json, '{}'::JSONB)
        || CASE
             WHEN l.purpose_text IS NOT NULL AND btrim(l.purpose_text) <> ''
             THEN jsonb_build_object('purpose', l.purpose_text)
             ELSE '{}'::JSONB
           END
        || jsonb_build_object(
               '_confidence',         cc.min_conf,
               '_tokens',             (SELECT count(*) FROM token_features),
               '_format',             p_format_name,
               '_assigned',           COALESCE(am.assigned_json, '{}'::JSONB),
               '_classifier_version', 'v3.1'
           )
    INTO v_result
    FROM winner_payload wp
    CROSS JOIN confidence_calc cc
    CROSS JOIN leftovers l
    LEFT JOIN assigned_map am ON TRUE;

    -- Coherence validation pass
    v_result := spendsense.fn_validate_parse_v31(
        p_channel_type,
        p_format_name,
        v_result
    );

    -- Restore metadata the validator may have cleared
    v_result := v_result || jsonb_build_object(
        '_tokens', COALESCE(
            (v_result->>'_tokens')::INT,
            (SELECT count(*)::INT
             FROM unnest(v_raw_tokens) AS q(x)
             WHERE x IS NOT NULL AND btrim(x) <> '')
        ),
        '_format',             p_format_name,
        '_classifier_version', 'v3.1'
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_validate_parse_v31(
    p_channel_type TEXT,
    p_format_name  TEXT,
    p_fields       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_result JSONB   := COALESCE(p_fields, '{}'::JSONB);
    v_conf   NUMERIC := COALESCE(
                            NULLIF((p_fields->>'_confidence'), '')::NUMERIC,
                            0.20);
    v_name   TEXT;
    v_bank   TEXT;
BEGIN
    IF v_result = '{}'::JSONB THEN
        RETURN jsonb_build_object(
            '_confidence', 0.20,
            '_format', p_format_name
        );
    END IF;

    IF p_channel_type = 'UPI' THEN
        -- Drop RRN if it fails shape check
        IF v_result ? 'upi_rrn'
           AND COALESCE(v_result->>'upi_rrn', '') !~ '^[0-9]{12,14}$' THEN
            v_result := v_result - 'upi_rrn';
            v_conf   := LEAST(v_conf, 0.60);
        END IF;

        -- Drop name if it duplicates bank
        v_name := NULLIF(TRIM(COALESCE(v_result->>'counterparty_name', '')), '');
        v_bank := NULLIF(TRIM(COALESCE(v_result->>'counterparty_bank', '')), '');
        IF v_name IS NOT NULL
           AND v_bank IS NOT NULL
           AND UPPER(v_name) = UPPER(v_bank) THEN
            v_result := v_result - 'counterparty_name';
            v_conf   := LEAST(v_conf, 0.65);
        END IF;

        -- Drop name if it is a known noise keyword
        IF v_result ? 'counterparty_name'
           AND UPPER(COALESCE(v_result->>'counterparty_name', ''))
               ~* '^(UPI|IN APP|SENT USI|PAYMEN|PAYMENT|DR|CR|REV|P2A|P2M|P2P|UPIINT|YESPAY)$'
        THEN
            v_result := v_result - 'counterparty_name';
            v_conf   := LEAST(v_conf, 0.62);
        END IF;

        -- Drop gateway if it was erroneously assigned the same token as VPA
        IF v_result ? 'counterparty_vpa'
           AND v_result ? 'gateway_name'
           AND UPPER(COALESCE(v_result->>'gateway_name', ''))
               = UPPER(COALESCE(v_result->>'counterparty_vpa', '')) THEN
            v_result := v_result - 'gateway_name';
            v_conf   := LEAST(v_conf, 0.70);
        END IF;
    END IF;

    IF p_channel_type = 'IMPS' THEN
        -- Drop RRN if not exactly 12 digits
        IF v_result ? 'imps_rrn'
           AND COALESCE(v_result->>'imps_rrn', '') !~ '^[0-9]{12}$' THEN
            v_result := v_result - 'imps_rrn';
            v_conf   := LEAST(v_conf, 0.60);
        END IF;
    END IF;

    IF p_channel_type = 'NEFT' THEN
        -- Drop UTR if implausibly short
        IF v_result ? 'neft_utr'
           AND length(COALESCE(v_result->>'neft_utr', '')) < 12 THEN
            v_result := v_result - 'neft_utr';
            v_conf   := LEAST(v_conf, 0.60);
        END IF;
    END IF;

    RETURN (v_result - '_confidence')
           || jsonb_build_object(
                  '_confidence', ROUND(v_conf, 2),
                  '_format',     p_format_name
              );
END;
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_parse_nach(
    p_norm_desc TEXT
)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_desc          TEXT;
    v_match         TEXT[];
    v_result        JSONB := '{}'::JSONB;
    v_entity        TEXT;
    v_exec_date_raw TEXT;
    v_exec_date     DATE;
    v_platform      TEXT;
    v_mandate_id    TEXT;
    v_run_ref       TEXT;
    v_ifsc          TEXT;
    v_confidence    NUMERIC := 0.93;
BEGIN
    -- Strip leading noise (timestamp / hex prefix before NACH)
    v_desc := regexp_replace(
        UPPER(TRIM(COALESCE(p_norm_desc, ''))),
        '^[0-9A-F/:\s]+(?=NACH\s)', '', 'i'
    );
    v_desc := TRIM(v_desc);

    -- Primary parse: entity+date+platform fused token
    -- e.g. NACH NSEMFS05032025CAMS 5950850995240 5011386641 CNRB…
    v_match := regexp_match(v_desc,
        'NACH\s+([A-Z]{2,8})(\d{8})([A-Z]{2,6})\s+(\d{10,14})\s+(\d{4,12})\s+([A-Z0-9]{11,20})');

    IF v_match IS NOT NULL THEN
        v_entity        := v_match[1];
        v_exec_date_raw := v_match[2];  -- DDMMYYYY
        v_platform      := v_match[3];
        v_mandate_id    := v_match[4];
        v_run_ref       := v_match[5];
        v_ifsc          := v_match[6];

        -- Parse date DDMMYYYY → DATE
        BEGIN
            v_exec_date := TO_DATE(v_exec_date_raw, 'DDMMYYYY');
        EXCEPTION WHEN OTHERS THEN
            v_exec_date := NULL;
            v_confidence := 0.80;
        END;

        v_result := jsonb_build_object(
            'ach_nach_entity',    v_entity,
            'nach_platform',      v_platform,
            'nach_exec_date',     v_exec_date,
            'mandate_or_run_id',  v_mandate_id,
            'ach_nach_ref',       v_run_ref,
            'counterparty_ifsc',  v_ifsc,
            '_confidence',        v_confidence,
            '_format',            'NACH_SPACE_MF'
        );
        RETURN v_result;
    END IF;

    -- Fallback: partial parse — just extract what we can
    -- Try to get mandate_id (long number) and IFSC
    v_match := regexp_match(v_desc, 'NACH\s+([A-Z0-9]+)\s+(\d{10,14})');
    IF v_match IS NOT NULL THEN
        v_result := jsonb_build_object(
            'ach_nach_entity',   v_match[1],
            'mandate_or_run_id', v_match[2],
            '_confidence',       0.60,
            '_format',           'NACH_PARTIAL'
        );
        RETURN v_result;
    END IF;

    RETURN jsonb_build_object(
        '_confidence', 0.20,
        '_format',     'NACH_UNKNOWN'
    );
END;
$$;

CREATE OR REPLACE FUNCTION spendsense.fn_parse_other_subtype(
    p_norm_desc TEXT
)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_desc  TEXT;
    v_match TEXT[];
    v_result JSONB;
BEGIN
    v_desc := UPPER(TRIM(COALESCE(p_norm_desc, '')));

    -- ── EMI (PPR…_EMI_…) ──────────────────────────────────
    IF v_desc ~* '^PPR\d+_EMI_' THEN
        v_match := regexp_match(v_desc,
            '^(PPR\d+)_EMI_(\d{2}-\d{2}-\d{4})_(.+)$');
        IF v_match IS NOT NULL THEN
            RETURN jsonb_build_object(
                'biller_code',    v_match[1],
                'purpose',        'EMI ' || v_match[2],
                'counterparty_name', TRIM(v_match[3]),
                '_sub_type',      'EMI',
                '_confidence',    0.90,
                '_format',        'EMI_PPR'
            );
        END IF;
        RETURN jsonb_build_object(
            '_sub_type',   'EMI',
            '_confidence', 0.60,
            '_format',     'EMI_PPR'
        );
    END IF;

    -- ── INTEREST_CREDIT ───────────────────────────────────
    IF v_desc ~* '^INTEREST PAID|^INTERESTPAID|^Int\.Pd:|^SB:[0-9]' THEN
        -- SB:ACCOUNT:Int.Pd:FROM to TO
        v_match := regexp_match(v_desc,
            'SB:(\d+):Int\.Pd:(\d{2}-\d{2}-\d{4})\s+to\s+(\d{2}-\d{2}-\d{4})');
        IF v_match IS NOT NULL THEN
            RETURN jsonb_build_object(
                'counterparty_account', v_match[1],
                'purpose',
                    'Interest ' || v_match[2] || ' to ' || v_match[3],
                '_sub_type',   'INTEREST_CREDIT',
                '_confidence', 0.90,
                '_format',     'INTEREST_CREDIT_SPACE'
            );
        END IF;
        -- Int.Pd:ACCOUNT:FROM to TO
        v_match := regexp_match(v_desc,
            'Int\.Pd:(\d+):(\d{2}-\d{2}-\d{4})\s+to\s+(\d{2}-\d{2}-\d{4})');
        IF v_match IS NOT NULL THEN
            RETURN jsonb_build_object(
                'counterparty_account', v_match[1],
                'purpose',
                    'Interest ' || v_match[2] || ' to ' || v_match[3],
                '_sub_type',   'INTEREST_CREDIT',
                '_confidence', 0.90,
                '_format',     'INTEREST_CREDIT_SPACE'
            );
        END IF;
        -- Plain "INTEREST PAID TILL DD-MON-YYYY"
        RETURN jsonb_build_object(
            'purpose',     TRIM(v_desc),
            '_sub_type',   'INTEREST_CREDIT',
            '_confidence', 0.75,
            '_format',     'INTEREST_CREDIT_SPACE'
        );
    END IF;

    -- ── BILLDESK ─────────────────────────────────────────
    IF v_desc ~* '[A-Z0-9]{12,}/BILLDK' THEN
        v_match := regexp_match(v_desc,
            '^([A-Z0-9]+)/BILLDK([A-Z0-9]+)\s+(\d{10,})');
        IF v_match IS NOT NULL THEN
            RETURN jsonb_build_object(
                'internal_ref',  v_match[1],
                'biller_code',   v_match[2],
                'mandate_or_run_id', v_match[3],
                '_sub_type',     'BILLDESK',
                '_confidence',   0.88,
                '_format',       'BILLDESK'
            );
        END IF;
        RETURN jsonb_build_object(
            '_sub_type',   'BILLDESK',
            '_confidence', 0.60,
            '_format',     'BILLDESK'
        );
    END IF;

    -- ── POS CC BILL (POS416021XXXXXX1514PZHDFCCCBILLP …) ─
    IF v_desc ~* '^POS[0-9]{6}X+[0-9]{4}[A-Z]{2}HDFC' THEN
        v_match := regexp_match(v_desc,
            '^POS([0-9]{6}X+[0-9]{4})([A-Z0-9]+)\s*(\d*)');
        IF v_match IS NOT NULL THEN
            RETURN jsonb_build_object(
                'card_ref',      v_match[1],
                'biller_code',   v_match[2],
                'internal_ref',  NULLIF(v_match[3], ''),
                '_sub_type',     'CC_PAYMENT',
                '_channel_override', 'CARD_BILLPAY',
                '_confidence',   0.88,
                '_format',       'POS_CC_BILL'
            );
        END IF;
    END IF;

    -- No specific sub-type matched
    RETURN jsonb_build_object(
        '_sub_type',   'TRUNCATED',
        '_confidence', 0.20,
        '_format',     'OTHER_UNKNOWN'
    );
END;
$$;


-- ============================================================================
-- SECTION 16 — fn_build_parse_error_reasons  (NEW in v4)
--
-- Inspects the parsed JSONB output and the raw stage record to build
-- an array of reason codes explaining why a row is PARTIAL or UNPARSED.
-- Called at the end of populate_txn_parsed_v3 for every non-PARSED row.
--
-- Returns TEXT[] — empty array means no specific reason captured.
-- ============================================================================

CREATE OR REPLACE FUNCTION spendsense.fn_build_parse_error_reasons(
    p_channel_type  TEXT,
    p_parse_format  TEXT,
    p_sub_type      TEXT,
    p_fields        JSONB,          -- output of fn_classify_tokens / fn_parse_nach
    p_confidence    NUMERIC,
    p_parse_status  TEXT            -- PARSED / PARTIAL / UNPARSED
)
RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_reasons TEXT[] := ARRAY[]::TEXT[];
    v_conf    NUMERIC := COALESCE(p_confidence, 0);
BEGIN
    -- Nothing to explain for a fully PARSED row
    IF p_parse_status = 'PARSED' THEN
        RETURN NULL;
    END IF;

    -- No format matched at all
    IF p_parse_format IS NULL
       OR COALESCE(p_fields->>'_format', 'OTHER_UNKNOWN') = 'OTHER_UNKNOWN' THEN
        v_reasons := array_append(v_reasons, 'NO_FORMAT_MATCH');
    END IF;

    -- Description was a truncated fragment
    IF p_sub_type = 'TRUNCATED' THEN
        v_reasons := array_append(v_reasons, 'TRUNCATED_DESCRIPTION');
    END IF;

    -- Confidence below threshold (but a format did match)
    IF p_parse_format IS NOT NULL
       AND p_sub_type IS DISTINCT FROM 'TRUNCATED'
       AND v_conf < 0.70 THEN
        v_reasons := array_append(v_reasons, 'LOW_CONFIDENCE');
    END IF;

    -- Channel-specific missing field checks
    IF p_channel_type = 'UPI' THEN
        IF (p_fields->>'upi_rrn') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_RRN');
        END IF;
        IF (p_fields->>'counterparty_name') IS NULL
           AND (p_fields->>'merchant_name') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_NAME');
        END IF;
        IF (p_fields->>'counterparty_vpa') IS NULL
           AND p_parse_format NOT IN ('UPI_DASH','REV_DASH') THEN
            -- VPA is optional in dash format; expected in slash formats
            v_reasons := array_append(v_reasons, 'NO_VPA');
        END IF;
    END IF;

    IF p_channel_type = 'IMPS' THEN
        IF (p_fields->>'imps_rrn') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_RRN');
        END IF;
        IF (p_fields->>'counterparty_name') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_NAME');
        END IF;
    END IF;

    IF p_channel_type = 'NEFT' THEN
        IF (p_fields->>'neft_utr') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_UTR');
        END IF;
        IF (p_fields->>'counterparty_name') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_NAME');
        END IF;
    END IF;

    IF p_channel_type IN ('ACH','NACH') THEN
        IF (p_fields->>'ach_nach_entity') IS NULL
           AND (p_fields->>'ach_entity') IS NULL THEN
            v_reasons := array_append(v_reasons, 'NO_ENTITY');
        END IF;
    END IF;

    -- Coherence validator fired (dropped a field)
    -- Signalled when confidence was capped by the validator (< original)
    IF (p_fields->>'_coherence_dropped') IS NOT NULL THEN
        -- Check specific drop type
        IF p_fields->>'_coherence_dropped' = 'CONFLICT' THEN
            v_reasons := array_append(v_reasons, 'MULTIPLE_MATCH_CONFLICT');
        ELSE
            v_reasons := array_append(v_reasons, 'COHERENCE_FAIL');
        END IF;
    END IF;

    -- Deduplicate and return NULL if empty (cleaner than empty array in prod)
    v_reasons := ARRAY(SELECT DISTINCT unnest(v_reasons) ORDER BY 1);
    RETURN CASE WHEN array_length(v_reasons, 1) > 0 THEN v_reasons ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION spendsense.fn_build_parse_error_reasons(TEXT,TEXT,TEXT,JSONB,NUMERIC,TEXT) IS
'Returns TEXT[] of reason codes for PARTIAL/UNPARSED rows.
 NULL for fully PARSED rows. Query: WHERE ''NO_RRN'' = ANY(parse_error_reasons)';


-- ============================================================================
-- SECTION 17 — PIPELINE FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION spendsense.parse_narration_v4(
    p_description text,
    p_direction text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = spendsense, pg_temp
AS $parse$
DECLARE
    v_norm text;
    v_fmt record;
    v_channel text;
    v_sub_type text;
    v_stage_status text;
    v_stage_confidence numeric;
    v_cr_dr char(1);
    v_direction text;
    v_fields jsonb;
    v_status text;
    v_confidence numeric;
    v_errors text[];
BEGIN
    v_norm := spendsense.fn_norm_desc(p_description);
    SELECT * INTO v_fmt FROM spendsense.fn_detect_format_v3(v_norm);
    v_channel := COALESCE(v_fmt.channel_type, CASE
        WHEN v_norm ~* '^(UPI[/-]|REV-UPI-|UPIOUT/|UPI IN/)' THEN 'UPI'
        WHEN v_norm ~* '(^IMPS[-/]|MMT/IMPS/|MOB-IMPS-|INET-IMPS-|FT IMPS/)' THEN 'IMPS'
        WHEN v_norm ~* '^NEFT' THEN 'NEFT'
        WHEN v_norm ~* '^(ACH-DR-|ACH D-|ACH/|DEBIT-ACH)' THEN 'ACH'
        WHEN v_norm ~* '^NACH\s+[A-Z]' THEN 'NACH'
        WHEN v_norm ~* '^(NWD-|ATM WDL-|ATM-CASH/|TO INTL\. ATM)' THEN 'ATM'
        WHEN v_norm ~* '^POS [0-9A-Z]{12}' THEN 'POS'
        WHEN v_norm ~* '^(IBBILLPAYDR-|IB BILLPAY DR-)' THEN 'CARD_BILLPAY'
        ELSE 'OTHER'
    END);
    v_sub_type := CASE
        WHEN v_norm ~* '^CreditCard Payment XX' THEN 'CC_PAYMENT'
        WHEN v_norm ~* '^MOB/TPFT/' THEN 'MOB_TRANSFER'
        WHEN v_norm ~* '^PPR\d+_EMI_' THEN 'EMI'
        WHEN v_norm ~* '^INTEREST PAID|^INTERESTPAID|^Int\.Pd:|^SB:[0-9]' THEN 'INTEREST_CREDIT'
        WHEN v_norm ~* '^CHQPAID-|^CHQ ' THEN 'CHEQUE'
        WHEN v_norm ~* '^BY CASH DEPOSIT' THEN 'CASH_DEPOSIT'
        WHEN v_norm ~* '[A-Z0-9]{12,}/BILLDK' THEN 'BILLDESK'
        WHEN v_norm ~* '^POS[0-9]{6}X+[0-9]{4}[A-Z]{2}HDFC' THEN 'CC_PAYMENT'
        WHEN COALESCE(v_fmt.channel_type, 'OTHER') = 'OTHER'
         AND (length(trim(v_norm)) <= 10 OR v_norm ~* '^(NE|PHONE|MPHONE|HONE|E|AUTO)$') THEN 'TRUNCATED'
        ELSE NULL
    END;
    v_stage_status := CASE
        WHEN coalesce(p_description, '') = '' THEN 'UNPARSED'
        WHEN v_sub_type = 'TRUNCATED' THEN 'UNPARSED'
        WHEN v_fmt.format_id IS NULL THEN 'PARTIAL'
        ELSE 'READY'
    END;
    v_stage_confidence := CASE
        WHEN coalesce(p_description, '') = '' THEN 0.00
        WHEN v_sub_type = 'TRUNCATED' THEN 0.10
        WHEN v_fmt.format_id IS NULL THEN 0.40
        ELSE COALESCE(v_fmt.parse_confidence, 0.85)
    END;
    v_cr_dr := CASE
        WHEN lower(coalesce(p_direction, '')) IN ('credit', 'cr', 'c', 'in') THEN 'C'
        ELSE 'D'
    END;
    v_direction := spendsense.fn_derive_direction_v3(
        COALESCE(v_fmt.direction_rule, 'LEDGER'),
        v_fmt.direction_token_pos,
        v_norm,
        COALESCE(v_fmt.delimiter, '-'),
        v_cr_dr
    );
    IF v_channel = 'NACH' THEN
        v_fields := spendsense.fn_parse_nach(v_norm);
    ELSIF v_channel = 'OTHER' AND v_sub_type IN ('EMI', 'INTEREST_CREDIT', 'BILLDESK', 'CC_PAYMENT') THEN
        v_fields := spendsense.fn_parse_other_subtype(v_norm);
    ELSIF v_channel = 'POS' AND v_fmt.format_name = 'POS_NOSPACE' THEN
        v_fields := jsonb_build_object(
            'card_ref', (regexp_match(v_norm, '^POS([0-9]{6}X+[0-9]{4})'))[1],
            'merchant_name', regexp_replace(v_norm, '^POS[0-9]{6}X+[0-9]{4}', ''),
            '_confidence', 0.85,
            '_format', 'POS_NOSPACE'
        );
    ELSIF v_channel = 'ATM' AND v_fmt.format_name = 'ATM_WDL_DASH' THEN
        v_fields := jsonb_build_object(
            'atm_txn_id', (regexp_match(v_norm, '^ATM WDL-ATM CASH (\d+)'))[1],
            'atm_location', (regexp_match(v_norm, '^ATM WDL-ATM CASH \d+ ([A-Z ]+)-?$'))[1],
            '_confidence', 0.88,
            '_format', 'ATM_WDL_DASH'
        );
    ELSIF v_channel = 'CARD_BILLPAY' THEN
        v_fields := spendsense.fn_classify_tokens(v_norm, 'CARD_BILLPAY', v_fmt.format_name, '-', ARRAY[0]::int[], NULL);
    ELSIF v_fmt.format_name IS NOT NULL THEN
        v_fields := spendsense.fn_classify_tokens(
            v_norm, v_channel, v_fmt.format_name, v_fmt.delimiter, v_fmt.skip_positions, v_fmt.prefix_strip_regex
        );
    ELSE
        v_fields := jsonb_build_object('_confidence', 0.20, '_format', 'OTHER_UNKNOWN');
    END IF;
    v_fields := COALESCE(v_fields, '{}'::jsonb);
    v_confidence := COALESCE(NULLIF(v_fields->>'_confidence', '')::numeric, v_stage_confidence);
    v_status := CASE
        WHEN v_stage_status = 'UNPARSED' THEN 'UNPARSED'
        WHEN v_fmt.format_name IS NULL OR COALESCE(v_fmt.format_name, 'OTHER_UNKNOWN') = 'OTHER_UNKNOWN' THEN 'PARTIAL'
        WHEN v_confidence >= 0.70 THEN 'PARSED'
        ELSE 'PARTIAL'
    END;
    v_errors := spendsense.fn_build_parse_error_reasons(
        COALESCE(NULLIF(v_fields->>'_channel_override', ''), v_channel),
        v_fmt.format_name,
        COALESCE(v_fields->>'_sub_type', v_sub_type),
        v_fields,
        v_confidence,
        v_status
    );
    RETURN jsonb_build_object(
        'parse_version', 'v4',
        'normalized_description', v_norm,
        'channel_type', COALESCE(NULLIF(v_fields->>'_channel_override', ''), v_channel),
        'direction', v_direction,
        'parse_format', COALESCE(v_fields->>'_format', v_fmt.format_name),
        'sub_type', COALESCE(v_fields->>'_sub_type', v_sub_type),
        'parse_status', v_status,
        'parse_confidence', v_confidence,
        'parse_error_reasons', to_jsonb(COALESCE(v_errors, ARRAY[]::text[])),
        'fields', v_fields
    );
END;
$parse$;

INSERT INTO ref.adapter_registry (adapter_id, adapter_version, source_type, layout_code, status, implementation_ref)
VALUES ('parser-v4', 'v4', 'BANK_STATEMENT_CSV', 'NARRATION_V4', 'ACTIVE', 'spendsense.parse_narration_v4')
ON CONFLICT (adapter_id, adapter_version) DO NOTHING;

CREATE OR REPLACE FUNCTION ops.enqueue_statement_extraction(p_document uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $enqueue$
DECLARE
    v_owner uuid;
    v_status text;
    v_reasons text[];
    v_meta jsonb;
    v_hash text;
    v_key text;
BEGIN
    SELECT owner_id, status, reason_codes, metadata, content_hash, object_reference
      INTO v_owner, v_status, v_reasons, v_meta, v_hash, v_key
      FROM core.source_document
     WHERE source_document_id = p_document;
    IF v_status IS DISTINCT FROM 'AVAILABLE' OR NOT ('SCAN_CLEAN' = ANY (COALESCE(v_reasons, ARRAY[]::text[])))
       OR coalesce(v_meta->>'sealed', 'false') <> 'true' OR v_hash IS NULL OR v_key IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;
    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    )
    SELECT v_owner, 'STATEMENT_EXTRACTION_REQUESTED', 'source_document', p_document,
           jsonb_build_object(
               'source_document_id', p_document,
               'object_key', v_key,
               'sha256', v_hash,
               'file_type', v_meta->>'file_type',
               'parser_version', 'v4'
           ),
           'statement-extract:' || p_document::text
     WHERE NOT EXISTS (
         SELECT 1 FROM ops.outbox_event
          WHERE dedupe_key = 'statement-extract:' || p_document::text
            AND owner_id = v_owner
     );
    RETURN jsonb_build_object('outcome', 'queued');
END;
$enqueue$;

CREATE OR REPLACE FUNCTION ops.claim_statement_extraction() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $claim$
DECLARE
    v_id uuid;
    v_payload jsonb;
BEGIN
    SELECT outbox_event_id, event_payload INTO v_id, v_payload
      FROM ops.outbox_event
     WHERE semantic_trigger_code = 'STATEMENT_EXTRACTION_REQUESTED'
       AND status IN ('PENDING', 'FAILED', 'PUBLISHING')
       AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'empty');
    END IF;
    UPDATE ops.outbox_event
       SET status = 'PUBLISHING',
           attempt_count = attempt_count + 1,
           last_attempt_at = clock_timestamp(),
           next_attempt_at = clock_timestamp() + interval '1 minute'
     WHERE outbox_event_id = v_id;
    RETURN jsonb_build_object('outcome', 'claimed', 'outbox_event_id', v_id, 'payload', v_payload);
END;
$claim$;

CREATE OR REPLACE FUNCTION ops.finish_statement_extraction(p_event uuid, p_ok boolean, p_error text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, pg_temp
AS $finish$
BEGIN
    IF p_ok THEN
        UPDATE ops.outbox_event
           SET status = 'PUBLISHED', published_at = clock_timestamp(), last_error_code = NULL, next_attempt_at = NULL
         WHERE outbox_event_id = p_event;
    ELSE
        UPDATE ops.outbox_event
           SET status = 'FAILED', last_error_code = 'EXTRACTION_FAILED',
               last_error_detail = left(coalesce(p_error, ''), 200),
               next_attempt_at = clock_timestamp() + interval '1 minute'
         WHERE outbox_event_id = p_event;
    END IF;
END;
$finish$;

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
    SELECT extraction_run_id INTO v_existing
      FROM core.extraction_run
     WHERE source_document_id = p_document AND adapter_version_id = v_adapter;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'replay', 'extraction_run_id', v_existing);
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
        jsonb_build_object('parser_version', 'v4')
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
    RETURN jsonb_build_object('outcome', 'created', 'extraction_run_id', v_run, 'status', v_run_status, 'row_count', v_seq);
END;
$save$;

REVOKE ALL ON FUNCTION spendsense.parse_narration_v4(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.enqueue_statement_extraction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.claim_statement_extraction() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.finish_statement_extraction(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.save_statement_extraction(uuid, text, jsonb, text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA spendsense TO monytix_api;
GRANT SELECT ON ALL TABLES IN SCHEMA spendsense TO monytix_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA spendsense TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.enqueue_statement_extraction(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.claim_statement_extraction() TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.finish_statement_extraction(uuid, boolean, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.save_statement_extraction(uuid, text, jsonb, text, uuid) TO monytix_api;

DO $$
BEGIN
    IF to_regclass('spendsense.txn_fact') IS NOT NULL
       OR to_regclass('spendsense.txn_parsed') IS NOT NULL
       OR to_regclass('spendsense.txn_parse_stage') IS NOT NULL THEN
        RAISE EXCEPTION 'legacy parser financial tables must not be created';
    END IF;
END $$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-4-PARSER-V4',
    'Parser v4 narration adapter',
    'D10 v1.2 FINAL FREEZE',
    'parser-v4',
    'Salvaged v4 registries and classifier functions. No txn_fact or txn_parsed table.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
