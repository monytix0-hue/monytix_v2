import type { DecisionRow, MissionRow } from "./decisions.js";
import type { JourneyItem, RewardsSummary } from "./outcomes.js";

const WEIGHT_NAMES: Record<string, string> = {
  W01_TIME: "Time",
  W02_COMFORT: "Comfort",
  W03_RISK: "Risk",
  W04_OBLIGATIONS: "Obligations",
  W05_IDENTITY: "Identity",
  W06_RELATIONSHIPS: "Relationships",
  W07_OPPORTUNITY: "Opportunity",
  W08_ATTENTION: "Attention",
  W09_RESILIENCE: "Resilience",
  W10_LEGACY: "Legacy",
};

export function metaEnvelope(requestId: string, apiVersion = "v1.2") {
  return {
    request_id: requestId,
    generated_at: new Date().toISOString(),
    api_version: apiVersion,
    recompute_status: "COMPLETE" as const,
  };
}

function phoneState(item: DecisionRow): "need_you" | "upcoming" | "made" {
  if (item.state === "SELECTED" || item.state === "EXECUTED") return "made";
  if (item.expires_at && Date.parse(item.expires_at) > Date.now()) return "upcoming";
  return "need_you";
}

function rupees(value: unknown): string | null {
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function phoneDecisions(items: DecisionRow[]) {
  const cards = items.map((item) => {
    const summary = item.trigger_summary ?? {};
    const choices = Array.isArray(item.option_set) ? item.option_set : [];
    const state = phoneState(item);
    const names = choices
      .map((choice) => (typeof choice.name === "string" ? choice.name : ""))
      .filter((name) => name.length > 0);
    return {
      id: item.decision_id,
      title: item.title,
      question: typeof summary.question === "string" ? summary.question : item.title,
      context: typeof summary.context === "string" ? summary.context : null,
      amount: rupees(summary.amount),
      timing: state === "upcoming" ? "Saved for later" : state === "made" ? "Marked" : "Needs a choice",
      state,
      badge: state === "upcoming" ? "UPCOMING" : state === "made" ? "MARKED" : "NEEDS A CHOICE",
      summary: names.length > 0 ? names.join(" · ") : null,
      weight_count: choices.length,
      choices,
    };
  });
  const featured = cards.find((card) => card.state === "need_you") ?? null;
  return {
    contract: "ui-decisions-v0.1" as const,
    empty_state: cards.length === 0,
    active_decision_count: cards.filter((card) => card.state === "need_you").length,
    heaviest: featured ? { available: true as const, ...featured } : { available: false as const },
    decisions: cards.filter((card) => card.id !== featured?.id),
  };
}

const SCREEN_WEIGHTS = [
  { name: "Resilience", meaning: "Protection you can count on later" },
  { name: "Risk", meaning: "How exposed this choice leaves you" },
  { name: "Comfort", meaning: "Money you can still use now" },
  { name: "Opportunity", meaning: "Room to grow what you set aside" },
];

export function decisionScreenFromRow(row: DecisionRow) {
  const summary = row.trigger_summary ?? {};
  const choices = (Array.isArray(row.option_set) ? row.option_set : []).map((choice, index) => ({
    id: typeof choice.id === "string" ? choice.id : `choice-${index + 1}`,
    name: typeof choice.name === "string" ? choice.name : typeof choice.label === "string" ? choice.label : "Choice",
    approach: typeof choice.approach === "string" ? choice.approach : null,
    amount: typeof choice.amount === "string" ? choice.amount : null,
    meters: Array.isArray(choice.meters) ? choice.meters : [],
    outcomes: Array.isArray(choice.outcomes) ? choice.outcomes : [],
    hint: typeof choice.hint === "string" ? choice.hint : null,
  }));
  return {
    decision: {
      id: row.decision_id,
      title: row.title,
      question: typeof summary.question === "string" ? summary.question : row.title,
      context: typeof summary.context === "string" ? summary.context : null,
      mattered: "The weights you marked highest are the ones this choice carries forward.",
      expected: [
        "The choice you mark is the one that carries forward",
        "You can still change your mind before you confirm",
      ],
    },
    tradeoff: {
      eyebrow: "THE TRADE-OFF",
      title: "What are you balancing?",
      description: "Every option moves the balance between money you can use now and protection you build for later.",
    },
    choices,
    weights: SCREEN_WEIGHTS.map((weight) => ({
      name: weight.name,
      priority: "MEDIUM",
      meaning: weight.meaning,
      importance: 0.45,
    })),
    solutions: [
      { title: "Keep it where it is", tag: "Highest access", detail: "Use an account you already have. No new product is required." },
      { title: "A short, accessible holding", tag: "Access and some return", detail: "Keeps the money reachable while it sits aside." },
      { title: "A longer option you can revisit", tag: "Return later", detail: "Only if you want to look again. The decision is already complete." },
    ],
    transparency: "These options follow from the decision you already made. Monytix does not create a Decision because a product is available.",
    optional_note: "Your Decision is still complete. You can return to these options later.",
  };
}

export function decisionsReadModel(items: DecisionRow[]) {
  const sorted = [...items].sort((a, b) => (b.decision_score ?? 0) - (a.decision_score ?? 0));
  const open = sorted.filter((item) => {
    if (item.state === "SELECTED" || item.state === "EXECUTED") return false;
    if (item.expires_at && Date.parse(item.expires_at) > Date.now()) return false;
    return true;
  });
  const heaviest = open[0] ?? null;
  return {
    awareness_score: items.length === 0 ? 0 : Math.min(100, 60 + items.length * 4),
    awareness_subtext:
      items.length === 0
        ? "No decision candidates yet."
        : `You have ${items.length} decision candidate${items.length === 1 ? "" : "s"} waiting.`,
    heaviest_decision: heaviest
      ? {
          decision_id: heaviest.decision_id,
          decision_family_code: heaviest.decision_family_code,
          title: heaviest.title || heaviest.decision_family_code,
          priority_band: heaviest.current_priority_band,
          fps_score: heaviest.decision_score,
          weights: [],
          tradeoff_thesis: null,
          options: (heaviest.option_set || []).map((opt) => ({
            option_id: String((opt as { id?: string }).id || (opt as { option_id?: string }).option_id || "OPT_1"),
            label: String((opt as { label?: string }).label || "Continue"),
            action: String((opt as { action?: string }).action || "ACCEPT"),
          })),
        }
      : null,
    upcoming_decisions: open.slice(1).map((item) => ({
      decision_id: item.decision_id,
      decision_family_code: item.decision_family_code,
      title: item.title || item.decision_family_code,
      due_in_days: null,
      weights: [] as string[],
      priority_band: item.current_priority_band,
    })),
    weight_balance_summary: {
      carried_wisely_count: 0,
      avoided_postponed_count: 0,
    },
    empty_state: items.length === 0,
  };
}

export function missionsReadModel(items: MissionRow[]) {
  const active = items.filter((item) => item.state === "ACTIVE" || item.state === "PAUSED");
  const mapped = active.map((item) => {
    const target = Number((item.target_definition as { default_target_inr?: number })?.default_target_inr || 0);
    const progress = Number(item.current_progress_inr || 0);
    const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 1000) / 10) : 0;
    return {
      mission_id: item.mission_id,
      canonical_code: item.canonical_mission_code,
      title: item.title,
      state: item.state,
      progress_pct: pct,
      current_progress_inr: progress,
      target_inr: target || null,
      primary_weights: [] as string[],
      milestones: [] as { threshold_inr: number; label: string; status: string }[],
      autopilot_enabled: false,
      autopilot_cadence: null as string | null,
    };
  });
  const overall =
    mapped.length === 0
      ? 0
      : mapped.reduce((sum, row) => sum + row.progress_pct, 0) / mapped.length;
  return {
    overall_completion_pct: Math.round(overall * 10) / 10,
    summary_caption:
      mapped.length === 0
        ? "Accept a decision to start a mission."
        : "Each mission is a conscious choice about which weights deserve your attention.",
    active_missions: mapped,
    empty_state: mapped.length === 0,
  };
}

export function rewardsReadModel(summary: RewardsSummary) {
  return {
    total_mile_points: summary.total_mile_points,
    clarity_moments_count: summary.clarity_moments_count,
    active_streak: {
      current_days: 0,
      multiplier: "1.0x",
      rule: "Consecutive days with at least 1 conscious decision tagged",
    },
    currency_impact: {
      saved_inr: summary.currency_impact.saved_inr,
      funded_inr: summary.currency_impact.funded_inr,
      invested_inr: summary.currency_impact.invested_inr,
      protected_inr: summary.currency_impact.protected_inr,
    },
    badges: [] as { badge_id: string; name: string; tier: string; progress: string }[],
    recent_clarity_milestones: summary.recent_clarity_milestones,
  };
}

export function journeyReadModel(items: JourneyItem[]) {
  return {
    chapter: {
      chapter_no: 1,
      chapter_name: items.length === 0 ? "Getting Started" : "The Builder Phase",
      clarity_score: Math.min(100, items.length * 8),
      narrative:
        items.length === 0
          ? "Your journey begins when verified outcomes mint M.I.L.E."
          : `${items.length} clarity moment${items.length === 1 ? "" : "s"} recorded from verified mission progress.`,
      key_moments: items.slice(0, 5).map((item) => ({
        date: item.occurred_at.slice(0, 10),
        title: item.mission_title || item.outcome_family_code || "Clarity moment",
        weights: [] as string[],
        mile_awarded: item.mile_awarded,
        mission_code: item.mission_code,
      })),
    },
    weight_mastery: {
      mastered_count: 0,
      total_count: 10,
      weights: Object.entries(WEIGHT_NAMES).map(([code, name]) => ({
        code,
        name,
        status: "UNEXPLORED",
        decisions_count: 0,
      })),
    },
    items,
  };
}
