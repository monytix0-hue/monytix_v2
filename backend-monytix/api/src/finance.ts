import { randomUUID } from "node:crypto";
import type {
  ApplyDecisionInput,
  DecisionActionInput,
  DecisionActionResult,
  DecisionEvalContext,
  DecisionRow,
  MissionRow,
} from "./decisions.js";
import { PRIMARY_ORBIT, fillWeights } from "./decisions.js";
import type {
  ApplyOutcomesMileInput,
  JourneyItem,
  OutcomeMatch,
  RewardsSummary,
} from "./outcomes.js";
import { missionMatchesLedger } from "./outcomes.js";
import type { DecisionMode, FeedbackAction, HumanContextResult, PendingFact, WeightCode } from "./human-context.js";
import { mentionsOtherAccount } from "./human-context.js";
import type { Normalized } from "./types.js";
import { DOMAIN_TABLE } from "./types.js";
import { phoneMileEvent, phoneMileEvents, phoneMileSummary, type MileFact } from "./mile-read.js";
import { decisionScreenFromRow, missionDefinitionDocument, missionDetailDocument, missionProgressLabel } from "./ui-read-models.js";

export type Override = { category_id: string; subcategory_id: string | null };

export type FxRate = { base_code: string; quote_code: string; rate: string; source: string };

export type FinanceWriter = {
  apply(ownerId: string, sourceMongoId: string, normalized: Normalized): Promise<string>;
  read(ownerId: string, bucket: string): Promise<unknown[]>;
  putOverride(ownerId: string, token: string, override: Override): Promise<void>;
  upsertFx(rateDate: string, rates: FxRate[]): Promise<void>;
  latestFx(): Promise<{ rate_date: string; rates: FxRate[] } | null>;
  linkForexFees(ownerId: string | null): Promise<{ linked: number }>;
  pendingHuman(ownerId: string): Promise<{ transactions: PendingFact[] }>;
  applyHumanContext(result: HumanContextResult): Promise<{ status: "APPLIED" }>;
  decisionEvalContext(transactionId: string): Promise<DecisionEvalContext | null>;
  applyDecisionEvaluation(input: ApplyDecisionInput): Promise<{ status: "DECISION_COMMITTED" }>;
  listDecisions(ownerId: string): Promise<DecisionRow[]>;
  decisionScreen(ownerId: string, decisionId: string): Promise<Record<string, unknown> | null>;
  applyDecisionAction(input: DecisionActionInput): Promise<DecisionActionResult>;
  sweepExpiredSnoozes(ownerId: string | null): Promise<{ swept: number }>;
  listMissions(ownerId: string): Promise<MissionRow[]>;
  missionDefinition(code: string): Promise<Record<string, unknown> | null>;
  createMission(input: { owner_id: string; canonical_mission_code: string; reach_amount: number; current_amount: number }): Promise<{ mission_id: string } | null>;
  addMissionProgress(input: { owner_id: string; mission_id: string; amount: number; note: string | null; idempotency_key: string }): Promise<Record<string, unknown> | null>;
  missionDetail(ownerId: string, missionId: string): Promise<Record<string, unknown> | null>;
  missionJournal(ownerId: string, missionId: string): Promise<Record<string, unknown> | null>;
  missionCompletion(ownerId: string, missionId: string): Promise<Record<string, unknown> | null>;
  pendingOutcomeMatches(ownerId: string | null): Promise<{ matches: OutcomeMatch[] }>;
  applyOutcomesMile(input: ApplyOutcomesMileInput): Promise<{ status: "APPLIED" }>;
  rewardsSummary(ownerId: string): Promise<RewardsSummary>;
  journeyItems(ownerId: string): Promise<JourneyItem[]>;
  mileSummary(ownerId: string): Promise<Record<string, unknown>>;
  listMileEvents(ownerId: string): Promise<Record<string, unknown>>;
  mileEvent(ownerId: string, eventId: string): Promise<Record<string, unknown> | null>;
  addWeightFeedback(ownerId: string, transactionId: string, input: WeightFeedbackInput): Promise<{ id: string }>;
  setDecisionMode(ownerId: string, transactionId: string, mode: DecisionMode, annotatedVia: string): Promise<{ mode: DecisionMode }>;
  addReflection(ownerId: string, transactionId: string, input: ReflectionInput): Promise<{ id: string }>;
  transactionContext(ownerId: string, transactionId: string): Promise<TransactionContext | null>;
};

export type WeightFeedbackInput = {
  weight_code: WeightCode;
  action: FeedbackAction;
  replaced_weight_code: WeightCode | null;
  client_idempotency_key: string;
};

export type ReflectionInput = {
  reflection_text: string | null;
  weight_feeling: string | null;
  dominant_felt_weight: WeightCode | null;
};

export type TransactionContext = {
  transaction_id: string;
  owner_id: string;
  eligibility_state: string | null;
  decision_mode: string | null;
  effective_weights: { code: string; name: string; is_primary: boolean; source: string; intensity: string }[];
  reflection_text: string | null;
  weight_feeling: string | null;
};

type LedgerStored = Normalized["ledger"][number] & { id: string; owner_id: string; account_id: string; source_mongo_id: string };

type EligibilityStored = { transaction_id: string; owner_id: string; state: string; reason_code: string };
type InferenceStored = { transaction_id: string; owner_id: string; primary_inferred_weight: string; secondary_inferred_weight: string | null };
type AssociationStored = {
  id: string;
  owner_id: string;
  target_id: string;
  weight_code: string;
  is_primary: boolean;
  effective_source: string;
  is_effective: boolean;
  version: number;
};
type FeedbackStored = WeightFeedbackInput & { id: string; owner_id: string; target_id: string };
type ModeStored = { transaction_id: string; owner_id: string; mode: DecisionMode; annotated_via: string; version: number };
type ReflectionStored = ReflectionInput & { id: string; owner_id: string; target_id: string; created_at: string };

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

export class MemoryFinance implements FinanceWriter {
  accounts: { id: string; owner_id: string; masked_account: string }[] = [];
  ledger: LedgerStored[] = [];
  dues: Record<string, unknown>[] = [];
  mutual_funds: Record<string, unknown>[] = [];
  investments: Record<string, unknown>[] = [];
  assets: Record<string, unknown>[] = [];
  debts: Record<string, unknown>[] = [];
  policies: Record<string, unknown>[] = [];
  overrides = new Map<string, Override>();
  fx: { rate_date: string; rates: FxRate[] } | null = null;
  eligibility: EligibilityStored[] = [];
  inferences: InferenceStored[] = [];
  associations: AssociationStored[] = [];
  feedback: FeedbackStored[] = [];
  modes: ModeStored[] = [];
  reflections: ReflectionStored[] = [];
  decisionEvaluations: {
    id: string;
    owner_id: string;
    family_code: string;
    decision_score: number;
    priority_band: string;
    idempotency_key: string;
    transaction_id: string;
  }[] = [];
  decisions: (DecisionRow & { idempotency_key: string })[] = [];
  missions: (MissionRow & { idempotency_key: string; current_progress_inr?: number })[] = [];
  progressEvents: { owner_id: string; mission_id: string; amount: number; note: string | null; idempotency_key: string }[] = [];
  decisionMissionLinks: { decision_id: string; mission_id: string; link_role: string }[] = [];
  decisionTransitions: { owner_id: string; decision_id: string; from_state: string | null; to_state: string; action_name: string; idempotency_key: string }[] = [];
  financialOutcomes: { id: string; owner_id: string; mission_id: string | null; transaction_id: string; idempotency_key: string; economic_event_key: string; observed_amount: number }[] = [];
  outcomeAttributions: { outcome_id: string; level: string }[] = [];
  financialImpacts: { owner_id: string; economic_impact_key: string; impact_type: string; amount: number }[] = [];
  mileEvents: {
    id: string;
    owner_id: string;
    mission_id: string | null;
    decision_id: string | null;
    dedupe_key: string;
    mile_awarded: number;
    impact_amount: number;
    outcome_family_code: string | null;
    event_type: string;
    occurred_at: string;
    status: string;
  }[] = [];

  async putOverride(ownerId: string, token: string, override: Override): Promise<void> {
    this.overrides.set(`${ownerId}:${token.toUpperCase()}`, override);
  }

  async apply(ownerId: string, sourceMongoId: string, normalized: Normalized): Promise<string> {
    const table = DOMAIN_TABLE[normalized.domain];
    if (normalized.domain === "LEDGER") {
      for (const row of normalized.ledger) {
        const override = this.overrides.get(`${ownerId}:${row.clean_merchant.toUpperCase()}`);
        const categoryId = override?.category_id ?? row.category_id;
        const subcategoryId = override ? override.subcategory_id : row.subcategory_id;
        const accountId = this.account(ownerId, row.masked_account);
        if (this.ledger.some((item) => item.source_mongo_id === sourceMongoId && item.line_no === row.line_no)) continue;
        if (row.payment_ref && this.ledger.some((item) => item.owner_id === ownerId && item.account_id === accountId && item.payment_ref === row.payment_ref)) continue;
        this.ledger.push({
          ...row,
          id: randomUUID(),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          is_user_overridden: Boolean(override),
          owner_id: ownerId,
          account_id: accountId,
          source_mongo_id: sourceMongoId,
        });
      }
      return table;
    }
    if (normalized.domain === "DUE_DATE" && normalized.due) {
      const due = normalized.due;
      if (!this.dues.some((item) => item.owner_id === ownerId && item.biller_name === due.biller_name && item.due_date === due.due_date)) {
        this.dues.push({ ...due, owner_id: ownerId, source_mongo_id: sourceMongoId, status: "PENDING" });
      }
      return table;
    }
    if (normalized.domain === "MUTUAL_FUND") {
      for (const holding of normalized.mutual_funds) {
        this.mutual_funds.push({ ...holding, owner_id: ownerId, source_mongo_id: sourceMongoId });
      }
      return table;
    }
    if (normalized.domain === "INVESTMENT") {
      for (const row of normalized.investments) this.investments.push({ ...row, owner_id: ownerId, source_mongo_id: sourceMongoId });
      return table;
    }
    if (normalized.domain === "ASSET") {
      for (const row of normalized.assets) this.assets.push({ ...row, owner_id: ownerId, source_mongo_id: sourceMongoId });
      return table;
    }
    if (normalized.domain === "DEBT") {
      for (const row of normalized.debts) this.debts.push({ ...row, owner_id: ownerId, source_mongo_id: sourceMongoId });
      return table;
    }
    if (normalized.domain === "INSURANCE") {
      for (const row of normalized.policies) this.policies.push({ ...row, owner_id: ownerId, source_mongo_id: sourceMongoId });
      return table;
    }
    return table;
  }

  async upsertFx(rateDate: string, rates: FxRate[]): Promise<void> {
    this.fx = { rate_date: rateDate, rates };
  }

  async linkForexFees(): Promise<{ linked: number }> {
    return { linked: 0 };
  }

  async pendingHuman(ownerId: string): Promise<{ transactions: PendingFact[] }> {
    const masks = this.accounts.filter((account) => account.owner_id === ownerId).map((account) => account.masked_account);
    const done = new Set(this.eligibility.filter((item) => item.owner_id === ownerId).map((item) => item.transaction_id));
    const transactions = this.ledger.filter((row) => row.owner_id === ownerId && !done.has(row.id)).map((row) => {
      if (row.channel !== "OWN_ACCOUNT_TRANSFER" && mentionsOtherAccount(row.raw_narration, row.masked_account, masks)) {
        row.channel = "OWN_ACCOUNT_TRANSFER";
      }
      return {
        transaction_id: row.id,
        owner_id: ownerId,
        amount: Number(row.amount),
        flow: row.flow,
        channel: row.channel,
        clean_merchant: row.clean_merchant,
        category_id: row.category_id,
        subcategory_id: row.subcategory_id,
        fee_role: row.fee_role ?? "BASE",
      };
    });
    return { transactions };
  }

  async decisionEvalContext(transactionId: string): Promise<DecisionEvalContext | null> {
    const row = this.ledger.find((item) => item.id === transactionId);
    if (!row) return null;
    const partial: Record<string, number> = {};
    for (const association of this.associations) {
      if (association.target_id === transactionId && association.is_effective) {
        partial[association.weight_code] = association.is_primary ? 1 : 0.6;
      }
    }
    return {
      transaction: {
        id: row.id,
        owner_id: row.owner_id,
        amount: Number(row.amount),
        flow: row.flow,
        clean_merchant: row.clean_merchant,
        category_id: row.category_id,
        subcategory_id: row.subcategory_id,
      },
      user_weights: fillWeights(partial),
    };
  }

  async applyDecisionEvaluation(input: ApplyDecisionInput): Promise<{ status: "DECISION_COMMITTED" }> {
    this.requireLedger(input.owner_id, input.transaction_id);
    const existing = this.decisionEvaluations.find(
      (item) => item.owner_id === input.owner_id && item.idempotency_key === input.evaluation_meta.idempotency_key,
    );
    const candidate = input.top_candidate;
    if (existing) {
      existing.decision_score = candidate.decision_score;
      existing.priority_band = candidate.priority_band;
    } else {
      this.decisionEvaluations.push({
        id: randomUUID(),
        owner_id: input.owner_id,
        family_code: candidate.decision_family_code,
        decision_score: candidate.decision_score,
        priority_band: candidate.priority_band,
        idempotency_key: input.evaluation_meta.idempotency_key,
        transaction_id: input.transaction_id,
      });
    }
    const decisionKey = `decision_instance:${input.evaluation_meta.idempotency_key}`;
    const found = this.decisions.find((item) => item.owner_id === input.owner_id && item.idempotency_key === decisionKey);
    if (found) {
      found.current_priority_band = candidate.priority_band;
      found.option_set = candidate.option_set;
      found.decision_score = candidate.decision_score;
      return { status: "DECISION_COMMITTED" };
    }
    this.decisions.push({
      decision_id: randomUUID(),
      owner_id: input.owner_id,
      decision_family_code: candidate.decision_family_code,
      title: candidate.display_name,
      state: "CANDIDATE",
      current_rank: 1,
      current_priority_band: candidate.priority_band,
      trigger_summary: candidate.trigger_summary,
      option_set: candidate.option_set,
      decision_score: candidate.decision_score,
      idempotency_key: decisionKey,
    });
    return { status: "DECISION_COMMITTED" };
  }

  async listDecisions(ownerId: string): Promise<DecisionRow[]> {
    return this.decisions
      .filter((item) => {
        if (item.owner_id !== ownerId) return false;
        return item.state === "CANDIDATE" || item.state === "PRESENTED" || item.state === "CONSIDERING" || item.state === "SELECTED" || item.state === "EXECUTED";
      })
      .sort((left, right) => (right.decision_score ?? 0) - (left.decision_score ?? 0) || (left.current_rank ?? 99) - (right.current_rank ?? 99));
  }

  async decisionScreen(ownerId: string, decisionId: string): Promise<Record<string, unknown> | null> {
    const row = this.decisions.find((item) => item.owner_id === ownerId && item.decision_id === decisionId);
    return row ? decisionScreenFromRow(row) : null;
  }

  async sweepExpiredSnoozes(ownerId: string | null): Promise<{ swept: number }> {
    const now = Date.now();
    let swept = 0;
    for (const decision of this.decisions) {
      if (ownerId && decision.owner_id !== ownerId) continue;
      if (!decision.expires_at) continue;
      if (Date.parse(decision.expires_at) > now) continue;
      decision.expires_at = null;
      if (decision.state !== "SELECTED" && decision.state !== "EXECUTED") {
        decision.state = "PRESENTED";
      }
      swept += 1;
    }
    return { swept };
  }

  async applyDecisionAction(input: DecisionActionInput): Promise<DecisionActionResult> {
    const decision = this.decisions.find((item) => item.decision_id === input.decision_id && item.owner_id === input.owner_id);
    if (!decision) throw new Error("decision_missing");
    const prior = this.decisionTransitions.find(
      (item) => item.owner_id === input.owner_id && item.idempotency_key === input.idempotency_key,
    );
    if (prior) {
      const linked = this.decisionMissionLinks.find((item) => item.decision_id === input.decision_id && item.link_role === "ORIGIN");
      const mission = linked ? this.missions.find((item) => item.mission_id === linked.mission_id) : null;
      return {
        decision_id: decision.decision_id,
        previous_state: prior.from_state ?? decision.state,
        current_state: prior.to_state,
        action: input.action,
        linked_mission_id: mission?.mission_id ?? null,
        mission_code: mission?.canonical_mission_code ?? null,
      };
    }

    const previousState = decision.state;
    let nextState = previousState;
    let linkedMissionId: string | null = null;
    let missionCode: string | null = null;

    if (input.action === "ACCEPT") {
      nextState = "SELECTED";
      decision.state = nextState;
      decision.selected_at = new Date().toISOString();
      decision.selected_option = { option_id: input.selected_option_id || "OPT_1" };
      const orbit = PRIMARY_ORBIT[decision.decision_family_code];
      if (orbit) {
        missionCode = orbit.code;
        const missionKey = `msn_orbit:${input.owner_id}:${orbit.code}`;
        let mission = this.missions.find((item) => item.owner_id === input.owner_id && item.idempotency_key === missionKey);
        if (!mission) {
          mission = {
            mission_id: randomUUID(),
            owner_id: input.owner_id,
            canonical_mission_code: orbit.code,
            title: orbit.title,
            state: "ACTIVE",
            origin_type: "DECISION_CREATED",
            target_definition: { metric_basis: orbit.title },
            idempotency_key: missionKey,
          };
          this.missions.push(mission);
        } else {
          mission.state = "ACTIVE";
        }
        linkedMissionId = mission.mission_id;
        if (!this.decisionMissionLinks.some((item) => item.decision_id === decision.decision_id && item.mission_id === mission!.mission_id && item.link_role === "ORIGIN")) {
          this.decisionMissionLinks.push({ decision_id: decision.decision_id, mission_id: mission.mission_id, link_role: "ORIGIN" });
        }
      }
    } else if (input.action === "SNOOZE") {
      nextState = "PRESENTED";
      decision.state = nextState;
      decision.expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (input.action === "SET_REMINDER") {
      if (!input.remind_at) throw new Error("remind_at_required");
      decision.expires_at = input.remind_at;
    }

    this.decisionTransitions.push({
      owner_id: input.owner_id,
      decision_id: decision.decision_id,
      from_state: previousState,
      to_state: nextState,
      action_name: input.action,
      idempotency_key: input.idempotency_key,
    });

    return {
      decision_id: decision.decision_id,
      previous_state: previousState,
      current_state: nextState,
      action: input.action,
      linked_mission_id: linkedMissionId,
      mission_code: missionCode,
    };
  }

  async listMissions(ownerId: string): Promise<MissionRow[]> {
    return this.missions
      .filter((item) => item.owner_id === ownerId && (item.state === "ACTIVE" || item.state === "PAUSED" || item.state === "COMPLETED"))
      .sort((left, right) => left.canonical_mission_code.localeCompare(right.canonical_mission_code));
  }

  async missionDefinition(code: string): Promise<Record<string, unknown> | null> {
    return missionDefinitionDocument(code);
  }

  async createMission(input: { owner_id: string; canonical_mission_code: string; reach_amount: number; current_amount: number }): Promise<{ mission_id: string } | null> {
    const fact = missionDefinitionDocument(input.canonical_mission_code);
    if (!fact) return null;
    const key = `user-mission:${input.canonical_mission_code}`;
    let mission = this.missions.find((item) => item.owner_id === input.owner_id && item.idempotency_key === key);
    if (!mission) {
      mission = {
        mission_id: randomUUID(),
        owner_id: input.owner_id,
        canonical_mission_code: input.canonical_mission_code,
        title: String(fact.title),
        state: "ACTIVE",
        origin_type: "USER_CREATED",
        target_definition: { default_target_inr: input.reach_amount, current_inr: input.current_amount, metric_basis: fact.basis },
        current_progress_inr: input.current_amount,
        category: String(fact.category),
        measurement_basis: String(fact.basis),
        product_need_class: String(fact.build),
        idempotency_key: key,
      };
      this.missions.push(mission);
    } else if (mission.state !== "COMPLETED" && mission.state !== "CANCELLED") {
      mission.target_definition = { ...mission.target_definition, default_target_inr: input.reach_amount };
      mission.current_progress_inr = Math.max(Number(mission.current_progress_inr || 0), input.current_amount);
    }
    return { mission_id: mission.mission_id };
  }

  async addMissionProgress(input: { owner_id: string; mission_id: string; amount: number; note: string | null; idempotency_key: string }): Promise<Record<string, unknown> | null> {
    const mission = this.missions.find((item) => item.owner_id === input.owner_id && item.mission_id === input.mission_id);
    if (!mission || (mission.state !== "ACTIVE" && mission.state !== "PAUSED")) return null;
    const seen = this.progressEvents.some((item) => item.owner_id === input.owner_id && item.idempotency_key === input.idempotency_key);
    if (!seen) {
      this.progressEvents.push({
        owner_id: input.owner_id,
        mission_id: input.mission_id,
        amount: input.amount,
        note: input.note,
        idempotency_key: input.idempotency_key,
      });
      const next = Number(mission.current_progress_inr || 0) + input.amount;
      const target = Number(mission.target_definition?.default_target_inr || 0);
      mission.current_progress_inr = next;
      if (target > 0 && next >= target) mission.state = "COMPLETED";
    }
    return {
      mission_id: mission.mission_id,
      state: mission.state,
      current_progress_inr: mission.current_progress_inr,
      progress: missionProgressLabel(mission),
    };
  }

  async missionDetail(ownerId: string, missionId: string): Promise<Record<string, unknown> | null> {
    const mission = this.missions.find((item) => item.owner_id === ownerId && item.mission_id === missionId);
    if (!mission) return null;
    const latest = [...this.progressEvents].reverse().find((item) => item.mission_id === missionId);
    const recent = latest ? latest.note || missionProgressLabel(mission) : null;
    return missionDetailDocument(mission, recent);
  }

  async missionJournal(ownerId: string, missionId: string): Promise<Record<string, unknown> | null> {
    const mission = this.missions.find((item) => item.owner_id === ownerId && item.mission_id === missionId);
    if (!mission) return null;
    return {
      since: missionProgressLabel(mission),
      entries: this.progressEvents
        .filter((item) => item.mission_id === missionId)
        .map((item) => ({ title: missionProgressLabel({ ...mission, current_progress_inr: item.amount, state: "ACTIVE", target_definition: {} }), detail: item.note || "Progress recorded" })),
    };
  }

  async missionCompletion(ownerId: string, missionId: string): Promise<Record<string, unknown> | null> {
    const detail = await this.missionDetail(ownerId, missionId);
    if (!detail) return null;
    const mission = detail.mission as { title?: string; changed?: string; proof?: string; unlocks?: string };
    return { mission: { title: mission.title, changed: mission.changed, proof: mission.proof, unlocks: mission.unlocks } };
  }

  async pendingOutcomeMatches(ownerId: string | null): Promise<{ matches: OutcomeMatch[] }> {
    const owners = ownerId
      ? [ownerId]
      : [...new Set(this.missions.filter((item) => item.state === "ACTIVE").map((item) => item.owner_id))].slice(0, 20);
    const matches: OutcomeMatch[] = [];
    for (const oid of owners) {
      const active = this.missions.filter((item) => item.owner_id === oid && item.state === "ACTIVE");
      for (const mission of active) {
        for (const row of this.ledger.filter((item) => item.owner_id === oid)) {
          if (!missionMatchesLedger(mission.canonical_mission_code, row.category_id, row.flow)) continue;
          const already = this.financialOutcomes.some(
            (item) => item.transaction_id === row.id && item.mission_id === mission.mission_id,
          );
          if (already) continue;
          const link = this.decisionMissionLinks.find((item) => item.mission_id === mission.mission_id && item.link_role === "ORIGIN");
          const decision = link ? this.decisions.find((item) => item.decision_id === link.decision_id) : null;
          matches.push({
            owner_id: oid,
            transaction: {
              id: row.id,
              amount: Number(row.amount),
              flow: row.flow,
              clean_merchant: row.clean_merchant,
              category_id: row.category_id,
              subcategory_id: row.subcategory_id,
              posted_at: row.posted_at ?? null,
              currency_code: row.currency_code || "INR",
            },
            active_mission: {
              mission_id: mission.mission_id,
              title: mission.title,
              canonical_mission_code: mission.canonical_mission_code,
              target_definition: mission.target_definition,
            },
            linked_decision: {
              decision_id: decision?.decision_id ?? null,
              state: decision?.state ?? null,
            },
          });
          if (matches.length >= 20) return { matches };
        }
      }
    }
    return { matches };
  }

  async applyOutcomesMile(input: ApplyOutcomesMileInput): Promise<{ status: "APPLIED" }> {
    const pkg = input.package;
    const existing = this.financialOutcomes.find(
      (item) => item.owner_id === input.owner_id && item.idempotency_key === pkg.outcome.idempotency_key,
    );
    let outcomeId = existing?.id;
    if (!existing) {
      outcomeId = randomUUID();
      this.financialOutcomes.push({
        id: outcomeId,
        owner_id: input.owner_id,
        mission_id: pkg.outcome.mission_id,
        transaction_id: input.transaction_id,
        idempotency_key: pkg.outcome.idempotency_key,
        economic_event_key: pkg.outcome.economic_event_key,
        observed_amount: pkg.outcome.observed_amount,
      });
      this.outcomeAttributions.push({ outcome_id: outcomeId, level: pkg.attribution.attribution_level });
    }
    if (!this.financialImpacts.some((item) => item.owner_id === input.owner_id && item.economic_impact_key === pkg.impact.economic_impact_key)) {
      this.financialImpacts.push({
        owner_id: input.owner_id,
        economic_impact_key: pkg.impact.economic_impact_key,
        impact_type: pkg.impact.impact_type,
        amount: pkg.impact.amount,
      });
    }
    if (!this.mileEvents.some((item) => item.owner_id === input.owner_id && item.dedupe_key === pkg.mile_event.dedupe_key)) {
      this.mileEvents.push({
        id: randomUUID(),
        owner_id: input.owner_id,
        mission_id: pkg.mile_event.mission_id,
        decision_id: pkg.mile_event.decision_id,
        dedupe_key: pkg.mile_event.dedupe_key,
        mile_awarded: pkg.mile_event.mile_awarded,
        impact_amount: pkg.impact.amount,
        outcome_family_code: pkg.mile_event.outcome_family_code,
        event_type: pkg.mile_event.event_type,
        occurred_at: pkg.mile_event.occurred_at || new Date().toISOString(),
        status: "FINALIZED",
      });
    }
    const mission = this.missions.find((item) => item.mission_id === pkg.outcome.mission_id);
    if (mission && !existing) {
      mission.current_progress_inr = (mission.current_progress_inr ?? 0) + pkg.outcome.observed_amount;
    }
    return { status: "APPLIED" };
  }

  async rewardsSummary(ownerId: string): Promise<RewardsSummary> {
    const miles = this.mileEvents.filter((item) => item.owner_id === ownerId && item.status === "FINALIZED");
    const impacts = this.financialImpacts.filter((item) => item.owner_id === ownerId);
    const sum = (type: string) => impacts.filter((item) => item.impact_type === type).reduce((acc, item) => acc + item.amount, 0);
    return {
      total_mile_points: miles.reduce((acc, item) => acc + item.mile_awarded, 0),
      clarity_moments_count: miles.length,
      currency_impact: {
        saved_inr: sum("SAVED"),
        funded_inr: sum("GOAL_FUNDED"),
        invested_inr: sum("WEALTH_CONTRIBUTION"),
        protected_inr: sum("PROTECTED"),
      },
      recent_clarity_milestones: [...miles]
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, 5)
        .map((item) => ({
          points: item.mile_awarded,
          family: item.outcome_family_code || "MP",
          occurred_at: item.occurred_at,
        })),
    };
  }

  private mileFacts(ownerId: string): MileFact[] {
    return this.mileEvents
      .filter((item) => item.owner_id === ownerId && item.status === "FINALIZED")
      .map((item) => {
        const mission = this.missions.find((row) => row.mission_id === item.mission_id);
        const decision = this.decisions.find((row) => row.decision_id === item.decision_id);
        return {
          id: item.id,
          family: item.outcome_family_code,
          miles: item.mile_awarded,
          impact: item.impact_amount,
          occurred_at: item.occurred_at,
          mission_id: item.mission_id,
          mission_title: mission?.title ?? null,
          decision_id: item.decision_id,
          decision_title: decision?.title ?? null,
          event_type: item.event_type,
        };
      });
  }

  async mileSummary(ownerId: string): Promise<Record<string, unknown>> {
    return phoneMileSummary(this.mileFacts(ownerId));
  }

  async listMileEvents(ownerId: string): Promise<Record<string, unknown>> {
    return phoneMileEvents(this.mileFacts(ownerId));
  }

  async mileEvent(ownerId: string, eventId: string): Promise<Record<string, unknown> | null> {
    return phoneMileEvent(this.mileFacts(ownerId), eventId);
  }

  async journeyItems(ownerId: string): Promise<JourneyItem[]> {
    return this.mileEvents
      .filter((item) => item.owner_id === ownerId && item.status === "FINALIZED")
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 20)
      .map((item) => {
        const mission = this.missions.find((row) => row.mission_id === item.mission_id);
        return {
          mile_event_id: item.id,
          mile_awarded: item.mile_awarded,
          outcome_family_code: item.outcome_family_code,
          mission_id: item.mission_id,
          mission_title: mission?.title ?? null,
          mission_code: mission?.canonical_mission_code ?? null,
          occurred_at: item.occurred_at,
        };
      });
  }

  async applyHumanContext(result: HumanContextResult): Promise<{ status: "APPLIED" }> {
    this.requireLedger(result.owner_id, result.transaction_id);
    const existing = this.eligibility.find((item) => item.transaction_id === result.transaction_id);
    if (existing) {
      existing.state = result.eligibility.state;
      existing.reason_code = result.eligibility.reason_code;
    } else {
      this.eligibility.push({
        transaction_id: result.transaction_id,
        owner_id: result.owner_id,
        state: result.eligibility.state,
        reason_code: result.eligibility.reason_code,
      });
    }
    const alreadyInferred = this.inferences.some((item) => item.transaction_id === result.transaction_id);
    if (!result.inference_run || result.weight_associations.length === 0 || alreadyInferred) return { status: "APPLIED" };
    this.inferences.push({
      transaction_id: result.transaction_id,
      owner_id: result.owner_id,
      primary_inferred_weight: result.inference_run.primary_inferred_weight,
      secondary_inferred_weight: result.inference_run.secondary_inferred_weight,
    });
    for (const weight of result.weight_associations) {
      if (this.associations.some((item) => item.target_id === result.transaction_id && item.weight_code === weight.weight_code && item.is_effective)) continue;
      this.associations.push({
        id: randomUUID(),
        owner_id: result.owner_id,
        target_id: result.transaction_id,
        weight_code: weight.weight_code,
        is_primary: weight.is_primary,
        effective_source: "SYSTEM_INFERENCE",
        is_effective: true,
        version: 1,
      });
    }
    return { status: "APPLIED" };
  }

  async addWeightFeedback(ownerId: string, transactionId: string, input: WeightFeedbackInput): Promise<{ id: string }> {
    this.requireLedger(ownerId, transactionId);
    const existing = this.feedback.find((item) => item.owner_id === ownerId && item.client_idempotency_key === input.client_idempotency_key);
    if (existing) return { id: existing.id };
    const id = randomUUID();
    this.feedback.push({ ...input, id, owner_id: ownerId, target_id: transactionId });
    const current = this.associations.filter((item) => item.owner_id === ownerId && item.target_id === transactionId && item.is_effective && item.weight_code === input.weight_code);
    for (const item of current) item.is_effective = false;
    const nextVersion = current.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    if (input.action === "CONFIRMED" || input.action === "USER_ADDED") {
      this.associations.push(this.userAssociation(ownerId, transactionId, input.weight_code, input.action === "CONFIRMED", nextVersion));
    }
    if (input.action === "REPLACED" && input.replaced_weight_code) {
      this.associations.push(this.userAssociation(ownerId, transactionId, input.replaced_weight_code, true, nextVersion));
    }
    return { id };
  }

  async setDecisionMode(ownerId: string, transactionId: string, mode: DecisionMode, annotatedVia: string): Promise<{ mode: DecisionMode }> {
    this.requireLedger(ownerId, transactionId);
    const existing = this.modes.find((item) => item.transaction_id === transactionId);
    if (existing) {
      existing.mode = mode;
      existing.annotated_via = annotatedVia;
      existing.version += 1;
      return { mode };
    }
    this.modes.push({ transaction_id: transactionId, owner_id: ownerId, mode, annotated_via: annotatedVia, version: 1 });
    return { mode };
  }

  async addReflection(ownerId: string, transactionId: string, input: ReflectionInput): Promise<{ id: string }> {
    this.requireLedger(ownerId, transactionId);
    const id = randomUUID();
    this.reflections.push({ ...input, id, owner_id: ownerId, target_id: transactionId, created_at: new Date().toISOString() });
    return { id };
  }

  async transactionContext(ownerId: string, transactionId: string): Promise<TransactionContext | null> {
    const row = this.ledger.find((item) => item.id === transactionId && item.owner_id === ownerId);
    if (!row) return null;
    const eligibility = this.eligibility.find((item) => item.transaction_id === transactionId);
    const mode = this.modes.find((item) => item.transaction_id === transactionId);
    const reflection = [...this.reflections].reverse().find((item) => item.target_id === transactionId);
    return {
      transaction_id: transactionId,
      owner_id: ownerId,
      eligibility_state: eligibility?.state ?? null,
      decision_mode: mode?.mode ?? null,
      effective_weights: this.associations
        .filter((item) => item.target_id === transactionId && item.is_effective)
        .map((item) => ({
          code: item.weight_code,
          name: WEIGHT_NAMES[item.weight_code] ?? item.weight_code,
          is_primary: item.is_primary,
          source: item.effective_source,
          intensity: "1.00",
        })),
      reflection_text: reflection?.reflection_text ?? null,
      weight_feeling: reflection?.weight_feeling ?? null,
    };
  }

  private userAssociation(ownerId: string, transactionId: string, code: string, primary: boolean, version: number): AssociationStored {
    return {
      id: randomUUID(),
      owner_id: ownerId,
      target_id: transactionId,
      weight_code: code,
      is_primary: primary,
      effective_source: "USER_FEEDBACK",
      is_effective: true,
      version,
    };
  }

  private requireLedger(ownerId: string, transactionId: string): LedgerStored {
    const row = this.ledger.find((item) => item.id === transactionId && item.owner_id === ownerId);
    if (!row) throw new Error("transaction_missing");
    return row;
  }

  async latestFx(): Promise<{ rate_date: string; rates: FxRate[] } | null> {
    return this.fx;
  }

  async read(ownerId: string, bucket: string): Promise<unknown[]> {
    const rows = this.bucket(bucket);
    return rows.filter((row) => row.owner_id === ownerId);
  }

  private bucket(name: string): { owner_id?: string }[] {
    const map: Record<string, { owner_id?: string }[]> = {
      transactions: this.ledger,
      "due-alerts": this.dues,
      "mutual-funds": this.mutual_funds,
      investments: this.investments,
      assets: this.assets,
      debts: this.debts,
      insurance: this.policies,
    };
    return map[name] ?? [];
  }

  private account(ownerId: string, masked: string): string {
    const existing = this.accounts.find((item) => item.owner_id === ownerId && item.masked_account === masked);
    if (existing) return existing.id;
    const id = randomUUID();
    this.accounts.push({ id, owner_id: ownerId, masked_account: masked });
    return id;
  }
}
