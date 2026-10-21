export type DecisionCandidate = {
  decision_family_code: string;
  display_name: string;
  decision_group: string;
  base_weight_fit: number;
  urgency_multiplier: number;
  confidence_multiplier: number;
  context_modifier: number;
  decision_score: number;
  priority_band: string;
  trigger_summary: Record<string, unknown>;
  option_set: Record<string, unknown>[];
};

export type DecisionEvalContext = {
  transaction: {
    id: string;
    owner_id: string;
    amount: number;
    flow: string;
    clean_merchant: string;
    category_id: string;
    subcategory_id: string | null;
  };
  user_weights: Record<string, number>;
};

export type ApplyDecisionInput = {
  owner_id: string;
  transaction_id: string;
  top_candidate: DecisionCandidate;
  evaluation_meta: { idempotency_key: string; all_evaluated_count?: number };
};

export type DecisionRow = {
  decision_id: string;
  owner_id: string;
  decision_family_code: string;
  title: string | null;
  state: string;
  current_rank: number | null;
  current_priority_band: string;
  trigger_summary: Record<string, unknown>;
  option_set: Record<string, unknown>[];
  decision_score: number | null;
  selected_option?: Record<string, unknown> | null;
  expires_at?: string | null;
  selected_at?: string | null;
};

export const DECISION_ACTIONS = ["ACCEPT", "SNOOZE", "SET_REMINDER"] as const;
export type DecisionActionName = (typeof DECISION_ACTIONS)[number];

export type DecisionActionInput = {
  decision_id: string;
  owner_id: string;
  action: DecisionActionName;
  remind_at?: string | null;
  selected_option_id?: string | null;
  idempotency_key: string;
};

export type DecisionActionResult = {
  decision_id: string;
  previous_state: string;
  current_state: string;
  action: DecisionActionName;
  linked_mission_id: string | null;
  mission_code: string | null;
};

export type MissionRow = {
  mission_id: string;
  owner_id: string;
  canonical_mission_code: string;
  title: string;
  state: string;
  origin_type: string;
  target_definition: Record<string, unknown>;
  current_progress_inr?: number;
  idempotency_key?: string;
};

/** First PRIMARY orbit by mission code for families that PROMOTE can produce. */
export const PRIMARY_ORBIT: Record<string, { code: string; title: string }> = {
  D1: { code: "M01", title: "Build an Emergency Buffer" },
  D2: { code: "M02", title: "Build an Income-Loss Buffer" },
  D10: { code: "M30", title: "Stop Financial Leakage" },
  D13: { code: "M06", title: "Build 6-12 Months of Security" },
};

export const ALL_WEIGHTS = [
  "W01_TIME",
  "W02_COMFORT",
  "W03_RISK",
  "W04_OBLIGATIONS",
  "W05_IDENTITY",
  "W06_RELATIONSHIPS",
  "W07_OPPORTUNITY",
  "W08_ATTENTION",
  "W09_RESILIENCE",
  "W10_LEGACY",
] as const;

export function fillWeights(partial: Record<string, number>): Record<string, number> {
  const filled: Record<string, number> = {};
  for (const code of ALL_WEIGHTS) filled[code] = partial[code] ?? 0.5;
  return filled;
}
