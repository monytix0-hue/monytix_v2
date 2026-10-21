export type Domain =
  | "LEDGER"
  | "DUE_DATE"
  | "MUTUAL_FUND"
  | "INVESTMENT"
  | "ASSET"
  | "DEBT"
  | "INSURANCE";

export type LedgerRow = {
  line_no: number;
  amount: string;
  flow: "IN" | "OUT";
  channel: string;
  payment_ref: string | null;
  payment_network?: string | null;
  raw_narration: string;
  clean_merchant: string;
  gateway?: string | null;
  legal_entity?: string | null;
  operating_country?: string | null;
  category_id: string;
  subcategory_id: string | null;
  fee_role?: "BASE" | "FCY_MARKUP" | "GST_TAX" | "OTHER_SURCHARGE";
  posted_at: string;
  masked_account: string;
  institution: string | null;
  currency_code: string;
  is_user_overridden?: boolean;
};

export type DueRow = {
  biller_name: string;
  amount_due: string;
  due_date: string;
  instrument_type: string;
  currency_code: string;
};

export type FundTxn = {
  transaction_date: string;
  type: string;
  amount: string;
  units: string | null;
  nav: string | null;
};

export type FundHolding = {
  folio_number: string;
  scheme_name: string;
  isin: string | null;
  units: string;
  nav: string | null;
  nav_date: string | null;
  current_value: string | null;
  currency_code: string;
  transactions: FundTxn[];
};

export type InvestmentRow = {
  instrument_name: string;
  isin: string;
  asset_class: string;
  units: string | null;
  price: string | null;
  value: string | null;
  as_of_date: string | null;
  currency_code: string;
};

export type AssetRow = {
  institution: string | null;
  account_number: string;
  principal_amount: string;
  interest_rate: string | null;
  maturity_date: string | null;
  maturity_amount: string | null;
  currency_code: string;
};

export type DebtRow = {
  lender_name: string;
  account_or_loan_number: string;
  loan_type: string;
  principal_amount: string | null;
  outstanding_balance: string;
  emi_amount: string | null;
  interest_rate: string | null;
  next_emi_date: string | null;
  currency_code: string;
};

export type PolicyRow = {
  provider: string;
  policy_number: string;
  policy_type: string;
  sum_insured: string;
  premium_amount: string;
  premium_frequency: string;
  renewal_date: string;
  policy_status: string;
  currency_code: string;
};

export type Normalized = {
  domain: Domain;
  ledger: LedgerRow[];
  due: DueRow | null;
  mutual_funds: FundHolding[];
  investments: InvestmentRow[];
  assets: AssetRow[];
  debts: DebtRow[];
  policies: PolicyRow[];
  decrypted_fi: unknown;
};

export type InboundRecord = {
  _id: string;
  owner_id: string;
  source: "GMAIL" | "PDF_UPLOAD" | "ACCOUNT_AGGREGATOR";
  channel_type: string;
  payload: Record<string, unknown>;
  ingest_status: "PENDING" | "ROUTED" | "FAILED";
  idempotency_key: string;
  created_at: string;
  routed_at?: string;
  error?: string;
};

export const DOMAIN_TABLE: Record<Domain, string> = {
  LEDGER: "ledger_transactions",
  DUE_DATE: "due_date_notifications",
  MUTUAL_FUND: "mf_holdings",
  INVESTMENT: "investment_holdings",
  ASSET: "asset_holdings",
  DEBT: "debt_liabilities",
  INSURANCE: "insurance_policies",
};
