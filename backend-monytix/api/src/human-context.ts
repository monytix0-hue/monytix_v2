export const WEIGHTS = [
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

export const MODES = ["CONSCIOUS", "AUTOMATIC", "AVOIDED"] as const;
export const ACTIONS = ["CONFIRMED", "REJECTED", "USER_ADDED", "REMOVED", "REPLACED"] as const;

export type WeightCode = (typeof WEIGHTS)[number];
export type DecisionMode = (typeof MODES)[number];
export type FeedbackAction = (typeof ACTIONS)[number];

export type PendingFact = {
  transaction_id: string;
  owner_id: string;
  amount: number;
  flow: string;
  channel: string;
  clean_merchant: string;
  category_id: string;
  subcategory_id: string | null;
  fee_role: string;
};

export type HumanContextResult = {
  transaction_id: string;
  owner_id: string;
  eligibility: { state: string; reason_code: string; evidence?: Record<string, unknown> };
  inference_run: {
    primary_inferred_weight: string;
    secondary_inferred_weight: string | null;
    confidence_score: number;
    rule_id: string;
    model_version: string;
  } | null;
  weight_associations: { weight_code: string; is_primary: boolean; intensity: number }[];
};

export function mentionsOtherAccount(narration: string, ownMask: string, otherMasks: string[]): boolean {
  return otherMasks.some((mask) => mask !== ownMask && mask.length >= 4 && bounded(narration, mask));
}

function bounded(narration: string, mask: string): boolean {
  const escaped = mask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`).test(narration);
}
