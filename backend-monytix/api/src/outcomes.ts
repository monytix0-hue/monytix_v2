export type OutcomeMatch = {
  owner_id: string;
  transaction: {
    id: string;
    amount: number;
    flow: string;
    clean_merchant: string;
    category_id: string;
    subcategory_id: string | null;
    posted_at: string | null;
    currency_code: string;
  };
  active_mission: {
    mission_id: string;
    title: string;
    canonical_mission_code: string;
    target_definition: Record<string, unknown>;
  };
  linked_decision: {
    decision_id: string | null;
    state: string | null;
  };
};

export type OutcomesMilePackage = {
  outcome: {
    outcome_family_code: string;
    outcome_type: string;
    decision_id: string | null;
    mission_id: string | null;
    observed_amount: number;
    currency: string;
    verification_status: string;
    outcome_status: string;
    economic_event_key: string;
    idempotency_key: string;
    observed_at: string | null;
    reason_codes: string[];
  };
  attribution: {
    attribution_level: string;
    attribution_factor: number;
    decision_id: string | null;
    mission_id: string | null;
    reason_codes: string[];
  };
  impact: {
    outcome_family_code: string;
    impact_type: string;
    impact_basis: string;
    amount: number;
    currency: string;
    attribution_level: string;
    attribution_factor: number;
    economic_impact_key: string;
    status: string;
  };
  mile_event: {
    event_type: string;
    outcome_family_code: string;
    attribution_level: string;
    base_value: number;
    magnitude_factor: number;
    significance_factor: number;
    confidence_factor: number;
    mile_awarded: number;
    status: string;
    dedupe_key: string;
    economic_event_key: string;
    occurred_at: string | null;
    decision_id: string | null;
    mission_id: string | null;
  };
};

export type ApplyOutcomesMileInput = {
  owner_id: string;
  transaction_id: string;
  package: OutcomesMilePackage;
};

export type RewardsSummary = {
  total_mile_points: number;
  clarity_moments_count: number;
  currency_impact: {
    saved_inr: number;
    funded_inr: number;
    invested_inr: number;
    protected_inr: number;
  };
  recent_clarity_milestones: { points: number; family: string; occurred_at: string }[];
};

export type JourneyItem = {
  mile_event_id: string;
  mile_awarded: number;
  outcome_family_code: string | null;
  mission_id: string | null;
  mission_title: string | null;
  mission_code: string | null;
  occurred_at: string;
};

export function missionMatchesLedger(
  code: string,
  categoryId: string,
  flow: string,
): boolean {
  if (["M01", "M02", "M06"].includes(code)) {
    return categoryId === "FINANCIAL_SERVICES" || flow === "IN";
  }
  if (code === "M30") {
    return flow === "OUT" && (categoryId === "FOOD_DINING" || categoryId === "SHOPPING_RETAIL");
  }
  return false;
}
