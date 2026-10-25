import type pg from "pg";
import type {
  ApplyDecisionInput,
  DecisionActionInput,
  DecisionActionResult,
  DecisionEvalContext,
  DecisionRow,
  MissionRow,
} from "./decisions.js";
import { fillWeights } from "./decisions.js";
import type {
  ApplyOutcomesMileInput,
  JourneyItem,
  OutcomeMatch,
  RewardsSummary,
} from "./outcomes.js";
import type { DecisionMode, HumanContextResult, PendingFact } from "./human-context.js";
import { mentionsOtherAccount } from "./human-context.js";
import type { Normalized } from "./types.js";
import { DOMAIN_TABLE } from "./types.js";
import type { FinanceWriter, FxRate, Override, ReflectionInput, TransactionContext, WeightFeedbackInput } from "./finance.js";

export class PgFinance implements FinanceWriter {
  constructor(private readonly pool: pg.Pool) {}

  async putOverride(ownerId: string, token: string, override: Override): Promise<void> {
    await this.withOwner(ownerId, async (client) => {
      await client.query(
        `INSERT INTO finance.user_category_overrides (owner_id, match_token, category_id, subcategory_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, match_token) DO UPDATE SET category_id = EXCLUDED.category_id, subcategory_id = EXCLUDED.subcategory_id`,
        [ownerId, token.toUpperCase(), override.category_id, override.subcategory_id],
      );
    });
  }

  async apply(ownerId: string, sourceMongoId: string, normalized: Normalized): Promise<string> {
    await this.withOwner(ownerId, async (client) => {
      if (normalized.domain === "LEDGER") {
        for (const row of normalized.ledger) {
          const override = await client.query<{ category_id: string; subcategory_id: string | null }>(
            "SELECT category_id, subcategory_id FROM finance.user_category_overrides WHERE owner_id = $1 AND match_token = $2",
            [ownerId, row.clean_merchant.toUpperCase()],
          );
          const chosen = override.rows[0];
          const account = await client.query<{ id: string }>(
            `INSERT INTO finance.financial_accounts (owner_id, institution, masked_account, channel, currency_code)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (owner_id, masked_account) DO UPDATE SET channel = EXCLUDED.channel
             RETURNING id`,
            [ownerId, row.institution, row.masked_account, row.channel, row.currency_code],
          );
          await client.query(
            `INSERT INTO finance.ledger_transactions (
              owner_id, account_id, posted_at, amount, flow, channel, payment_ref, payment_network, raw_narration,
              clean_merchant, gateway, legal_entity, operating_country, category_id, subcategory_id, is_user_overridden,
              currency_code, source_mongo_id, line_no, fee_role
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            ON CONFLICT (source_mongo_id, line_no) DO NOTHING`,
            [
              ownerId, account.rows[0]?.id, row.posted_at, row.amount, row.flow, row.channel, row.payment_ref, row.payment_network ?? null,
              row.raw_narration, row.clean_merchant, row.gateway ?? null, row.legal_entity ?? null, row.operating_country ?? null,
              chosen?.category_id ?? row.category_id, chosen ? chosen.subcategory_id : row.subcategory_id, Boolean(chosen),
              row.currency_code, sourceMongoId, row.line_no, row.fee_role ?? "BASE",
            ],
          );
        }
      } else if (normalized.domain === "DUE_DATE" && normalized.due) {
        const due = normalized.due;
        await client.query(
          `INSERT INTO finance.due_date_notifications (owner_id, biller_name, amount_due, due_date, instrument_type, currency_code, source_mongo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (owner_id, biller_name, due_date) DO NOTHING`,
          [ownerId, due.biller_name, due.amount_due, due.due_date, due.instrument_type, due.currency_code, sourceMongoId],
        );
      } else if (normalized.domain === "MUTUAL_FUND") {
        for (const holding of normalized.mutual_funds) {
          const saved = await client.query<{ id: string }>(
            `INSERT INTO finance.mf_holdings (owner_id, folio_number, scheme_name, isin, units, nav, nav_date, current_value, currency_code, source_mongo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (owner_id, folio_number, isin) DO UPDATE SET units = EXCLUDED.units, nav = EXCLUDED.nav, current_value = EXCLUDED.current_value
             RETURNING id`,
            [ownerId, holding.folio_number, holding.scheme_name, holding.isin, holding.units, holding.nav, holding.nav_date, holding.current_value, holding.currency_code, sourceMongoId],
          );
          for (const txn of holding.transactions) {
            await client.query(
              `INSERT INTO finance.mf_transactions (holding_id, transaction_date, type, amount, units, nav, currency_code, source_mongo_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (holding_id, transaction_date, type, amount, units) DO NOTHING`,
              [saved.rows[0]?.id, txn.transaction_date, txn.type, txn.amount, txn.units, txn.nav, holding.currency_code, sourceMongoId],
            );
          }
        }
      } else if (normalized.domain === "ASSET") {
        for (const row of normalized.assets) {
          await client.query(
            `INSERT INTO finance.asset_holdings (owner_id, institution, account_number, principal_amount, interest_rate, maturity_date, maturity_amount, currency_code, source_mongo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (owner_id, account_number) DO UPDATE SET principal_amount = EXCLUDED.principal_amount, maturity_amount = EXCLUDED.maturity_amount, interest_rate = EXCLUDED.interest_rate`,
            [ownerId, row.institution, row.account_number, row.principal_amount, row.interest_rate, row.maturity_date, row.maturity_amount, row.currency_code, sourceMongoId],
          );
        }
      } else if (normalized.domain === "INVESTMENT") {
        for (const row of normalized.investments) {
          await client.query(
            `INSERT INTO finance.investment_holdings (owner_id, instrument_name, isin, asset_class, units, price, value, as_of_date, currency_code, source_mongo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (owner_id, isin) DO UPDATE SET units = EXCLUDED.units, price = EXCLUDED.price, value = EXCLUDED.value`,
            [ownerId, row.instrument_name, row.isin, row.asset_class, row.units, row.price, row.value, row.as_of_date, row.currency_code, sourceMongoId],
          );
        }
      } else if (normalized.domain === "DEBT") {
        for (const row of normalized.debts) {
          await client.query(
            `INSERT INTO finance.debt_liabilities (owner_id, lender_name, account_or_loan_number, loan_type, principal_amount, outstanding_balance, emi_amount, interest_rate, next_emi_date, currency_code, source_mongo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (owner_id, account_or_loan_number) DO UPDATE SET outstanding_balance = EXCLUDED.outstanding_balance, emi_amount = EXCLUDED.emi_amount`,
            [ownerId, row.lender_name, row.account_or_loan_number, row.loan_type, row.principal_amount, row.outstanding_balance, row.emi_amount, row.interest_rate, row.next_emi_date, row.currency_code, sourceMongoId],
          );
        }
      } else if (normalized.domain === "INSURANCE") {
        for (const row of normalized.policies) {
          await client.query(
            `INSERT INTO finance.insurance_policies (owner_id, provider, policy_number, policy_type, sum_insured, premium_amount, premium_frequency, renewal_date, policy_status, currency_code, source_mongo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (owner_id, policy_number) DO UPDATE SET premium_amount = EXCLUDED.premium_amount, renewal_date = EXCLUDED.renewal_date`,
            [ownerId, row.provider, row.policy_number, row.policy_type, row.sum_insured, row.premium_amount, row.premium_frequency, row.renewal_date, row.policy_status, row.currency_code, sourceMongoId],
          );
        }
      }
    });
    return DOMAIN_TABLE[normalized.domain];
  }

  async upsertFx(rateDate: string, rates: FxRate[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const rate of rates) {
        await client.query(
          `INSERT INTO finance.fx_rates (rate_date, base_code, quote_code, rate, source)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (rate_date, base_code, quote_code) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`,
          [rateDate, rate.base_code, rate.quote_code, rate.rate, rate.source],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async latestFx(): Promise<{ rate_date: string; rates: FxRate[] } | null> {
    const result = await this.pool.query<{ rate_date: string; base_code: string; quote_code: string; rate: string; source: string }>(
      `SELECT rate_date::text, base_code, quote_code, rate::text, source
       FROM finance.fx_rates
       WHERE rate_date = (SELECT MAX(rate_date) FROM finance.fx_rates)`,
    );
    const first = result.rows[0];
    if (!first) return null;
    return {
      rate_date: first.rate_date,
      rates: result.rows.map((row) => ({
        base_code: row.base_code.trim(),
        quote_code: row.quote_code.trim(),
        rate: row.rate,
        source: row.source,
      })),
    };
  }

  async pendingHuman(ownerId: string): Promise<{ transactions: PendingFact[] }> {
    return this.withOwner(ownerId, async (client) => {
      const accounts = await client.query<{ masked_account: string }>(
        "SELECT masked_account FROM finance.financial_accounts WHERE owner_id = $1",
        [ownerId],
      );
      const masks = accounts.rows.map((row) => row.masked_account);
      const pending = await client.query<{
        transaction_id: string;
        amount: string;
        flow: string;
        channel: string;
        raw_narration: string;
        clean_merchant: string;
        category_id: string;
        subcategory_id: string | null;
        fee_role: string;
        masked_account: string;
      }>(
        `SELECT lt.id::text AS transaction_id, lt.amount::text, lt.flow, lt.channel, lt.raw_narration,
                lt.clean_merchant, lt.category_id, lt.subcategory_id, lt.fee_role, a.masked_account
         FROM finance.ledger_transactions lt
         JOIN finance.financial_accounts a ON a.id = lt.account_id
         WHERE lt.owner_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM human_context.weight_eligibility_results el WHERE el.transaction_id = lt.id
           )
         ORDER BY lt.posted_at, lt.line_no`,
        [ownerId],
      );
      const transactions: PendingFact[] = [];
      for (const row of pending.rows) {
        let channel = row.channel;
        if (channel !== "OWN_ACCOUNT_TRANSFER" && mentionsOtherAccount(row.raw_narration, row.masked_account, masks)) {
          channel = "OWN_ACCOUNT_TRANSFER";
          await client.query(
            "UPDATE finance.ledger_transactions SET channel = 'OWN_ACCOUNT_TRANSFER' WHERE id = $1 AND owner_id = $2",
            [row.transaction_id, ownerId],
          );
        }
        transactions.push({
          transaction_id: row.transaction_id,
          owner_id: ownerId,
          amount: Number(row.amount),
          flow: row.flow,
          channel,
          clean_merchant: row.clean_merchant,
          category_id: row.category_id,
          subcategory_id: row.subcategory_id,
          fee_role: row.fee_role,
        });
      }
      return { transactions };
    });
  }

  async applyHumanContext(result: HumanContextResult): Promise<{ status: "APPLIED" }> {
    return this.withOwner(result.owner_id, async (client) => {
      await this.requireTransaction(client, result.owner_id, result.transaction_id);
      await client.query(
        `INSERT INTO human_context.weight_eligibility_results (transaction_id, owner_id, state, reason_code, evidence_summary)
         VALUES ($1, $2, $3::human_context.eligibility_state, $4, $5::jsonb)
         ON CONFLICT (transaction_id) DO UPDATE
         SET state = EXCLUDED.state, reason_code = EXCLUDED.reason_code, evidence_summary = EXCLUDED.evidence_summary, evaluated_at = NOW()`,
        [result.transaction_id, result.owner_id, result.eligibility.state, result.eligibility.reason_code, JSON.stringify(result.eligibility.evidence ?? {})],
      );
      if (!result.inference_run || result.weight_associations.length === 0) return { status: "APPLIED" as const };
      await client.query(
        `INSERT INTO human_context.weight_inference_runs (
           transaction_id, owner_id, primary_inferred_weight, secondary_inferred_weight, confidence_score, rule_id, model_version
         )
         SELECT $1, $2, $3::human_context.weight_code, $4::human_context.weight_code, $5, $6, $7
         WHERE NOT EXISTS (
           SELECT 1 FROM human_context.weight_inference_runs WHERE transaction_id = $1
         )`,
        [
          result.transaction_id, result.owner_id, result.inference_run.primary_inferred_weight,
          result.inference_run.secondary_inferred_weight, result.inference_run.confidence_score,
          result.inference_run.rule_id, result.inference_run.model_version,
        ],
      );
      for (const weight of result.weight_associations) {
        await client.query(
          `INSERT INTO human_context.weight_associations (
             owner_id, target_type, target_id, weight_code, is_primary, intensity, effective_source
           )
           SELECT $1, 'TRANSACTION', $2, $3::human_context.weight_code, $4, $5, 'SYSTEM_INFERENCE'
           WHERE NOT EXISTS (
             SELECT 1 FROM human_context.weight_associations
             WHERE target_type = 'TRANSACTION' AND target_id = $2 AND weight_code = $3::human_context.weight_code AND is_effective
           )`,
          [result.owner_id, result.transaction_id, weight.weight_code, weight.is_primary, weight.intensity],
        );
      }
      return { status: "APPLIED" as const };
    });
  }

  async decisionEvalContext(transactionId: string): Promise<DecisionEvalContext | null> {
    const client = await this.pool.connect();
    try {
      const txn = await client.query<{
        id: string;
        owner_id: string;
        amount: string;
        flow: string;
        clean_merchant: string;
        category_id: string;
        subcategory_id: string | null;
      }>(
        `SELECT id::text, owner_id::text, amount::text, flow, clean_merchant, category_id, subcategory_id
         FROM finance.ledger_transactions WHERE id = $1`,
        [transactionId],
      );
      const row = txn.rows[0];
      if (!row) return null;
      await client.query("SELECT set_config('app.owner_id', $1, true)", [row.owner_id]);
      const weights = await client.query<{ weight_code: string; is_primary: boolean; intensity: string }>(
        `SELECT weight_code::text, is_primary, intensity::text
         FROM human_context.weight_associations
         WHERE target_type = 'TRANSACTION' AND target_id = $1 AND is_effective`,
        [transactionId],
      );
      const partial: Record<string, number> = {};
      for (const item of weights.rows) {
        partial[item.weight_code] = Number(item.intensity) || (item.is_primary ? 1 : 0.6);
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
    } finally {
      client.release();
    }
  }

  async applyDecisionEvaluation(input: ApplyDecisionInput): Promise<{ status: "DECISION_COMMITTED" }> {
    return this.withOwner(input.owner_id, async (client) => {
      await this.requireTransaction(client, input.owner_id, input.transaction_id);
      const family = await client.query<{ decision_family_version_id: string }>(
        `SELECT decision_family_version_id::text
         FROM ref.decision_family
         WHERE decision_family_code = $1 AND status = 'ACTIVE'
         ORDER BY definition_version DESC LIMIT 1`,
        [input.top_candidate.decision_family_code],
      );
      const familyId = family.rows[0]?.decision_family_version_id;
      if (!familyId) throw new Error("family_missing");
      const policy = await client.query<{ decision_ranking_policy_version_id: string }>(
        `SELECT decision_ranking_policy_version_id::text
         FROM ref.decision_ranking_policy
         WHERE policy_id = 'FPS_V1' AND status = 'ACTIVE'
         ORDER BY policy_version DESC LIMIT 1`,
      );
      const candidate = input.top_candidate;
      const evaluation = await client.query<{ decision_evaluation_id: string }>(
        `INSERT INTO action.decision_evaluation (
           owner_id, decision_family_version_id, decision_ranking_policy_version_id,
           eligibility_status, base_weight_fit, urgency_multiplier, confidence_multiplier,
           context_modifier, decision_score, priority_band, trigger_type, trigger_reference_type,
           trigger_reference_id, option_set, idempotency_key
         ) VALUES (
           $1, $2, $3, 'ELIGIBLE', $4, $5, $6, $7, $8, $9, 'TRANSACTION_PROMOTE', 'TRANSACTION',
           $10, $11::jsonb, $12
         )
         ON CONFLICT (owner_id, idempotency_key) DO UPDATE
         SET decision_score = EXCLUDED.decision_score,
             priority_band = EXCLUDED.priority_band,
             option_set = EXCLUDED.option_set,
             evaluated_at = clock_timestamp()
         RETURNING decision_evaluation_id::text`,
        [
          input.owner_id, familyId, policy.rows[0]?.decision_ranking_policy_version_id ?? null,
          candidate.base_weight_fit, candidate.urgency_multiplier, candidate.confidence_multiplier,
          candidate.context_modifier, candidate.decision_score, candidate.priority_band,
          input.transaction_id, JSON.stringify(candidate.option_set), input.evaluation_meta.idempotency_key,
        ],
      );
      const decisionKey = `decision_instance:${input.evaluation_meta.idempotency_key}`;
      await client.query(
        `INSERT INTO action.decision (
           owner_id, decision_family_version_id, source_evaluation_id, origin_type, state, title,
           trigger_summary, option_set, current_rank, current_priority_band, idempotency_key
         ) VALUES ($1, $2, $3, 'SYSTEM_EVALUATED', 'CANDIDATE', $4, $5::jsonb, $6::jsonb, 1, $7, $8)
         ON CONFLICT (owner_id, idempotency_key) DO UPDATE
         SET current_priority_band = EXCLUDED.current_priority_band,
             option_set = EXCLUDED.option_set,
             source_evaluation_id = EXCLUDED.source_evaluation_id,
             updated_at = clock_timestamp()`,
        [
          input.owner_id, familyId, evaluation.rows[0]?.decision_evaluation_id, candidate.display_name,
          JSON.stringify(candidate.trigger_summary), JSON.stringify(candidate.option_set),
          candidate.priority_band, decisionKey,
        ],
      );
      return { status: "DECISION_COMMITTED" as const };
    });
  }

  async listDecisions(ownerId: string): Promise<DecisionRow[]> {
    return this.withOwner(ownerId, async (client) => {
      const result = await client.query<DecisionRow>(
        `SELECT d.decision_id::text, d.owner_id::text, f.decision_family_code, d.title, d.state,
                d.current_rank, d.current_priority_band, d.trigger_summary, d.option_set,
                e.decision_score::float8 AS decision_score,
                d.selected_option, d.expires_at, d.selected_at
         FROM action.decision d
         JOIN ref.decision_family f ON f.decision_family_version_id = d.decision_family_version_id
         LEFT JOIN action.decision_evaluation e ON e.decision_evaluation_id = d.source_evaluation_id
         WHERE d.owner_id = $1
           AND d.state IN ('CANDIDATE', 'PRESENTED', 'CONSIDERING', 'SELECTED', 'EXECUTED')
         ORDER BY e.decision_score DESC NULLS LAST, d.current_rank ASC NULLS LAST, d.created_at DESC`,
        [ownerId],
      );
      return result.rows;
    });
  }

  async decisionScreen(ownerId: string, decisionId: string): Promise<Record<string, unknown> | null> {
    return this.withOwner(ownerId, async (client) => {
      const result = await client.query<{ screen: Record<string, unknown> | null }>(
        `SELECT ops.phone_decision_screen($1::uuid, $2::uuid) AS screen`,
        [ownerId, decisionId],
      );
      return result.rows[0]?.screen ?? null;
    });
  }

  async sweepExpiredSnoozes(ownerId: string | null): Promise<{ swept: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (ownerId) {
        await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
      }
      const result = await client.query<{ decision_id: string }>(
        `UPDATE action.decision
         SET state = 'PRESENTED',
             expires_at = NULL,
             updated_at = clock_timestamp()
         WHERE expires_at IS NOT NULL
           AND expires_at <= clock_timestamp()
           AND state IN ('CANDIDATE', 'PRESENTED', 'CONSIDERING')
           AND ($1::uuid IS NULL OR owner_id = $1::uuid)
         RETURNING decision_id::text`,
        [ownerId],
      );
      await client.query("COMMIT");
      return { swept: result.rowCount ?? result.rows.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyDecisionAction(input: DecisionActionInput): Promise<DecisionActionResult> {
    return this.withOwner(input.owner_id, async (client) => {
      const prior = await client.query<{
        from_state: string | null;
        to_state: string;
        decision_id: string;
      }>(
        `SELECT from_state, to_state, decision_id::text
         FROM action.decision_state_transition
         WHERE owner_id = $1 AND idempotency_key = $2`,
        [input.owner_id, input.idempotency_key],
      );
      if (prior.rows[0]) {
        const link = await client.query<{ mission_id: string; code: string }>(
          `SELECT l.mission_id::text, mdef.canonical_mission_code AS code
           FROM action.decision_mission_link l
           JOIN action.mission m ON m.mission_id = l.mission_id
           JOIN ref.mission_definition mdef ON mdef.mission_definition_version_id = m.canonical_mission_definition_version_id
           WHERE l.decision_id = $1 AND l.link_role = 'ORIGIN'
           LIMIT 1`,
          [input.decision_id],
        );
        return {
          decision_id: input.decision_id,
          previous_state: prior.rows[0].from_state ?? prior.rows[0].to_state,
          current_state: prior.rows[0].to_state,
          action: input.action,
          linked_mission_id: link.rows[0]?.mission_id ?? null,
          mission_code: link.rows[0]?.code ?? null,
        };
      }

      const locked = await client.query<{
        decision_id: string;
        state: string;
        decision_family_version_id: string;
        decision_family_code: string;
      }>(
        `SELECT d.decision_id::text, d.state, d.decision_family_version_id::text, f.decision_family_code
         FROM action.decision d
         JOIN ref.decision_family f ON f.decision_family_version_id = d.decision_family_version_id
         WHERE d.decision_id = $1 AND d.owner_id = $2
         FOR UPDATE`,
        [input.decision_id, input.owner_id],
      );
      const decision = locked.rows[0];
      if (!decision) throw new Error("decision_missing");

      const previousState = decision.state;
      let nextState = previousState;
      let linkedMissionId: string | null = null;
      let missionCode: string | null = null;

      if (input.action === "ACCEPT") {
        nextState = "SELECTED";
        await client.query(
          `UPDATE action.decision
           SET state = $1, selected_at = clock_timestamp(),
               selected_option = jsonb_build_object('option_id', $2::text),
               updated_at = clock_timestamp()
           WHERE decision_id = $3`,
          [nextState, input.selected_option_id || "OPT_1", input.decision_id],
        );
        const orbit = await client.query<{
          mission_definition_version_id: string;
          display_name: string;
          canonical_mission_code: string;
          target_definition: Record<string, unknown>;
          measurement_contract: Record<string, unknown>;
          completion_contract: Record<string, unknown>;
        }>(
          `SELECT m.mission_definition_version_id::text, m.display_name, m.canonical_mission_code,
                  m.target_definition, m.measurement_contract, m.completion_contract
           FROM ref.mission_decision_orbit o
           JOIN ref.mission_definition m ON m.mission_definition_version_id = o.mission_definition_version_id
           WHERE o.decision_family_version_id = $1 AND o.orbit_role = 'PRIMARY'
           ORDER BY m.canonical_mission_code ASC
           LIMIT 1`,
          [decision.decision_family_version_id],
        );
        const canonical = orbit.rows[0];
        if (canonical) {
          missionCode = canonical.canonical_mission_code;
          const missionKey = `msn_orbit:${input.owner_id}:${canonical.canonical_mission_code}`;
          const mission = await client.query<{ mission_id: string }>(
            `INSERT INTO action.mission (
               owner_id, canonical_mission_definition_version_id, origin_type, state, title,
               target_definition, measurement_contract, completion_contract, idempotency_key
             ) VALUES ($1, $2, 'DECISION_CREATED', 'ACTIVE', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
             ON CONFLICT (owner_id, idempotency_key) DO UPDATE
             SET state = 'ACTIVE', updated_at = clock_timestamp()
             RETURNING mission_id::text`,
            [
              input.owner_id, canonical.mission_definition_version_id, canonical.display_name,
              JSON.stringify(canonical.target_definition), JSON.stringify(canonical.measurement_contract),
              JSON.stringify(canonical.completion_contract), missionKey,
            ],
          );
          linkedMissionId = mission.rows[0]?.mission_id ?? null;
          if (linkedMissionId) {
            await client.query(
              `INSERT INTO action.decision_mission_link (
                 owner_id, decision_id, mission_id, link_role, source
               ) VALUES ($1, $2, $3, 'ORIGIN', 'CANONICAL_ORBIT')
               ON CONFLICT (decision_id, mission_id, link_role) DO NOTHING`,
              [input.owner_id, input.decision_id, linkedMissionId],
            );
          }
        }
      } else if (input.action === "SNOOZE") {
        nextState = "PRESENTED";
        await client.query(
          `UPDATE action.decision
           SET state = $1, expires_at = clock_timestamp() + interval '7 days', updated_at = clock_timestamp()
           WHERE decision_id = $2`,
          [nextState, input.decision_id],
        );
      } else if (input.action === "SET_REMINDER") {
        if (!input.remind_at) throw new Error("remind_at_required");
        await client.query(
          `UPDATE action.decision
           SET expires_at = $1::timestamptz, updated_at = clock_timestamp()
           WHERE decision_id = $2`,
          [input.remind_at, input.decision_id],
        );
      }

      await client.query(
        `INSERT INTO action.decision_state_transition (
           owner_id, decision_id, from_state, to_state, trigger_type, action_name, idempotency_key
         ) VALUES ($1, $2, $3, $4, 'USER_ACTION', $5, $6)
         ON CONFLICT (owner_id, idempotency_key) DO NOTHING`,
        [input.owner_id, input.decision_id, previousState, nextState, input.action, input.idempotency_key],
      );

      return {
        decision_id: input.decision_id,
        previous_state: previousState,
        current_state: nextState,
        action: input.action,
        linked_mission_id: linkedMissionId,
        mission_code: missionCode,
      };
    });
  }

  async listMissions(ownerId: string): Promise<MissionRow[]> {
    return this.withOwner(ownerId, async (client) => {
      const result = await client.query<MissionRow>(
        `SELECT m.mission_id::text, m.owner_id::text, d.canonical_mission_code, m.title, m.state,
                m.origin_type, m.target_definition,
                COALESCE(m.current_progress_inr, 0)::float8 AS current_progress_inr
         FROM action.mission m
         JOIN ref.mission_definition d ON d.mission_definition_version_id = m.canonical_mission_definition_version_id
         WHERE m.owner_id = $1 AND m.state IN ('ACTIVE', 'PAUSED')
         ORDER BY d.canonical_mission_code ASC, m.created_at DESC`,
        [ownerId],
      );
      return result.rows;
    });
  }

  async pendingOutcomeMatches(ownerId: string | null): Promise<{ matches: OutcomeMatch[] }> {
    const client = await this.pool.connect();
    try {
      // is_local set_config only survives inside an open transaction; without BEGIN it is discarded.
      await client.query("BEGIN");
      let owners: string[] = [];
      if (ownerId) {
        owners = [ownerId];
      } else {
        const rows = await client.query<{ owner_id: string }>(
          `SELECT DISTINCT owner_id::text FROM action.mission WHERE state = 'ACTIVE' LIMIT 20`,
        );
        owners = rows.rows.map((row) => row.owner_id);
      }
      const matches: OutcomeMatch[] = [];
      for (const oid of owners) {
        await client.query("SELECT set_config('app.owner_id', $1, true)", [oid]);
        const result = await client.query<{
          id: string;
          amount: string;
          flow: string;
          clean_merchant: string;
          category_id: string;
          subcategory_id: string | null;
          posted_at: string | null;
          currency_code: string;
          mission_id: string;
          mission_title: string;
          canonical_mission_code: string;
          target_definition: Record<string, unknown>;
          decision_id: string | null;
          decision_state: string | null;
        }>(
          `SELECT lt.id::text, lt.amount::text, lt.flow, lt.clean_merchant, lt.category_id, lt.subcategory_id,
                  lt.posted_at::text, lt.currency_code,
                  m.mission_id::text, m.title AS mission_title, md.canonical_mission_code, m.target_definition,
                  d.decision_id::text, d.state AS decision_state
           FROM finance.ledger_transactions lt
           JOIN action.mission m ON m.owner_id = lt.owner_id AND m.state = 'ACTIVE'
           JOIN ref.mission_definition md ON md.mission_definition_version_id = m.canonical_mission_definition_version_id
           LEFT JOIN action.decision_mission_link dml ON dml.mission_id = m.mission_id AND dml.link_role = 'ORIGIN'
           LEFT JOIN action.decision d ON d.decision_id = dml.decision_id
           LEFT JOIN action.financial_outcome fo
             ON fo.source_reference_id = lt.id AND fo.mission_id = m.mission_id
           WHERE lt.owner_id = $1
             AND fo.financial_outcome_id IS NULL
             AND (
               (md.canonical_mission_code IN ('M01', 'M02', 'M06')
                 AND (lt.category_id = 'FINANCIAL_SERVICES' OR lt.flow = 'IN'))
               OR
               (md.canonical_mission_code = 'M30'
                 AND lt.flow = 'OUT'
                 AND lt.category_id IN ('FOOD_DINING', 'SHOPPING_RETAIL'))
             )
           ORDER BY lt.posted_at DESC NULLS LAST
           LIMIT $2`,
          [oid, 20 - matches.length],
        );
        for (const row of result.rows) {
          matches.push({
            owner_id: oid,
            transaction: {
              id: row.id,
              amount: Number(row.amount),
              flow: row.flow,
              clean_merchant: row.clean_merchant,
              category_id: row.category_id,
              subcategory_id: row.subcategory_id,
              posted_at: row.posted_at,
              currency_code: row.currency_code || "INR",
            },
            active_mission: {
              mission_id: row.mission_id,
              title: row.mission_title,
              canonical_mission_code: row.canonical_mission_code,
              target_definition: row.target_definition || {},
            },
            linked_decision: {
              decision_id: row.decision_id,
              state: row.decision_state,
            },
          });
        }
        if (matches.length >= 20) break;
      }
      await client.query("COMMIT");
      return { matches };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyOutcomesMile(input: ApplyOutcomesMileInput): Promise<{ status: "APPLIED" }> {
    return this.withOwner(input.owner_id, async (client) => {
      const pkg = input.package;
      const calibration = await client.query<{ mile_calibration_policy_version_id: string }>(
        `SELECT mile_calibration_policy_version_id::text
         FROM ref.mile_calibration_policy
         WHERE policy_id = 'MILE_V1' AND status = 'ACTIVE'
         ORDER BY policy_version DESC LIMIT 1`,
      );
      const finalization = await client.query<{ mile_finalization_policy_version_id: string }>(
        `SELECT mile_finalization_policy_version_id::text
         FROM ref.mile_finalization_policy
         WHERE policy_id = 'MILE_FINAL_V1' AND status = 'ACTIVE'
         ORDER BY policy_version DESC LIMIT 1`,
      );
      const outcome = await client.query<{ financial_outcome_id: string; inserted: boolean }>(
        `INSERT INTO action.financial_outcome (
           owner_id, outcome_family_code, outcome_type, decision_id, mission_id,
           source_reference_type, source_reference_id, economic_event_key, observed_amount, currency,
           verification_status, outcome_status, reason_codes, idempotency_key, observed_at, verified_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'LEDGER_TRANSACTION', $6, $7, $8, $9, $10, 'FINALIZED', $11::text[], $12,
           COALESCE($13::timestamptz, clock_timestamp()), clock_timestamp()
         )
         ON CONFLICT (owner_id, idempotency_key) DO UPDATE
         SET outcome_status = EXCLUDED.outcome_status
         RETURNING financial_outcome_id::text,
                   (xmax = 0) AS inserted`,
        [
          input.owner_id, pkg.outcome.outcome_family_code, pkg.outcome.outcome_type,
          pkg.outcome.decision_id, pkg.outcome.mission_id, input.transaction_id,
          pkg.outcome.economic_event_key, pkg.outcome.observed_amount, pkg.outcome.currency,
          pkg.outcome.verification_status, pkg.outcome.reason_codes,
          pkg.outcome.idempotency_key, pkg.outcome.observed_at,
        ],
      );
      const outcomeId = outcome.rows[0]?.financial_outcome_id;
      const inserted = outcome.rows[0]?.inserted === true;
      if (outcomeId && inserted) {
        await client.query(
          `INSERT INTO action.outcome_attribution (
             owner_id, financial_outcome_id, attribution_level, attribution_factor,
             decision_id, mission_id, source_reference_type, source_reference_id, reason_codes
           ) VALUES ($1, $2, $3, $4, $5, $6, 'LEDGER_TRANSACTION', $7, $8::text[])`,
          [
            input.owner_id, outcomeId, pkg.attribution.attribution_level, pkg.attribution.attribution_factor,
            pkg.attribution.decision_id, pkg.attribution.mission_id, input.transaction_id, pkg.attribution.reason_codes,
          ],
        );
      }
      await client.query(
        `INSERT INTO action.financial_impact_event (
           owner_id, financial_outcome_id, outcome_family_code, impact_type, impact_basis,
           amount, currency, attribution_level, attribution_factor, economic_impact_key, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'FINALIZED')
         ON CONFLICT (owner_id, economic_impact_key) DO NOTHING`,
        [
          input.owner_id, outcomeId, pkg.impact.outcome_family_code, pkg.impact.impact_type, pkg.impact.impact_basis,
          pkg.impact.amount, pkg.impact.currency, pkg.impact.attribution_level, pkg.impact.attribution_factor,
          pkg.impact.economic_impact_key,
        ],
      );
      await client.query(
        `INSERT INTO action.mile_event (
           owner_id, financial_outcome_id, decision_id, mission_id, event_type, outcome_family_code,
           mile_calibration_policy_version_id, mile_finalization_policy_version_id,
           attribution_level, base_value, magnitude_factor, significance_factor, confidence_factor,
           mile_awarded, status, economic_event_key, dedupe_key, occurred_at
         ) VALUES (
           $1, $2, $3, $4, 'OUTCOME', $5, $6, $7, $8, $9, $10, $11, $12, $13, 'FINALIZED', $14, $15,
           COALESCE($16::timestamptz, clock_timestamp())
         )
         ON CONFLICT (owner_id, dedupe_key) DO NOTHING`,
        [
          input.owner_id, outcomeId, pkg.mile_event.decision_id, pkg.mile_event.mission_id,
          pkg.mile_event.outcome_family_code,
          calibration.rows[0]?.mile_calibration_policy_version_id ?? null,
          finalization.rows[0]?.mile_finalization_policy_version_id ?? null,
          pkg.mile_event.attribution_level, pkg.mile_event.base_value, pkg.mile_event.magnitude_factor,
          pkg.mile_event.significance_factor, pkg.mile_event.confidence_factor, pkg.mile_event.mile_awarded,
          pkg.mile_event.economic_event_key, pkg.mile_event.dedupe_key, pkg.mile_event.occurred_at,
        ],
      );
      if (inserted && pkg.outcome.mission_id) {
        await client.query(
          `UPDATE action.mission
           SET current_progress_inr = current_progress_inr + $1, updated_at = clock_timestamp()
           WHERE mission_id = $2 AND owner_id = $3`,
          [pkg.outcome.observed_amount, pkg.outcome.mission_id, input.owner_id],
        );
      }
      return { status: "APPLIED" as const };
    });
  }

  async rewardsSummary(ownerId: string): Promise<RewardsSummary> {
    return this.withOwner(ownerId, async (client) => {
      const mile = await client.query<{ total_mile_points: string; total_clarity_moments: string }>(
        `SELECT total_mile_points::text, total_clarity_moments::text
         FROM action.v_lifetime_mile_summary WHERE owner_id = $1`,
        [ownerId],
      );
      const impact = await client.query<{
        total_saved_inr: string;
        total_reserve_funded_inr: string;
        total_invested_inr: string;
        total_protected_inr: string;
      }>(
        `SELECT total_saved_inr::text, total_reserve_funded_inr::text, total_invested_inr::text, total_protected_inr::text
         FROM action.v_financial_impact_summary WHERE owner_id = $1`,
        [ownerId],
      );
      const recent = await client.query<{ mile_awarded: string; outcome_family_code: string; occurred_at: string }>(
        `SELECT mile_awarded::text, outcome_family_code, occurred_at::text
         FROM action.mile_event
         WHERE owner_id = $1 AND status = 'FINALIZED'
         ORDER BY occurred_at DESC LIMIT 5`,
        [ownerId],
      );
      const m = mile.rows[0];
      const i = impact.rows[0];
      return {
        total_mile_points: Number(m?.total_mile_points ?? 0),
        clarity_moments_count: Number(m?.total_clarity_moments ?? 0),
        currency_impact: {
          saved_inr: Number(i?.total_saved_inr ?? 0),
          funded_inr: Number(i?.total_reserve_funded_inr ?? 0),
          invested_inr: Number(i?.total_invested_inr ?? 0),
          protected_inr: Number(i?.total_protected_inr ?? 0),
        },
        recent_clarity_milestones: recent.rows.map((row) => ({
          points: Number(row.mile_awarded),
          family: row.outcome_family_code,
          occurred_at: row.occurred_at,
        })),
      };
    });
  }

  async journeyItems(ownerId: string): Promise<JourneyItem[]> {
    return this.withOwner(ownerId, async (client) => {
      const result = await client.query<JourneyItem>(
        `SELECT e.mile_event_id::text, e.mile_awarded::float8 AS mile_awarded, e.outcome_family_code,
                e.mission_id::text, m.title AS mission_title, d.canonical_mission_code AS mission_code,
                e.occurred_at::text AS occurred_at
         FROM action.mile_event e
         LEFT JOIN action.mission m ON m.mission_id = e.mission_id
         LEFT JOIN ref.mission_definition d ON d.mission_definition_version_id = m.canonical_mission_definition_version_id
         WHERE e.owner_id = $1 AND e.status = 'FINALIZED'
         ORDER BY e.occurred_at DESC
         LIMIT 20`,
        [ownerId],
      );
      return result.rows;
    });
  }

  async addWeightFeedback(ownerId: string, transactionId: string, input: WeightFeedbackInput): Promise<{ id: string }> {
    return this.withOwner(ownerId, async (client) => {
      await this.requireTransaction(client, ownerId, transactionId);
      const saved = await client.query<{ id: string }>(
        `INSERT INTO human_context.weight_feedback (
           owner_id, target_type, target_id, weight_code, action, replaced_weight_code, client_idempotency_key
         ) VALUES ($1, 'TRANSACTION', $2, $3::human_context.weight_code, $4::human_context.feedback_action, $5::human_context.weight_code, $6)
         ON CONFLICT (owner_id, client_idempotency_key) DO NOTHING
         RETURNING id::text`,
        [ownerId, transactionId, input.weight_code, input.action, input.replaced_weight_code, input.client_idempotency_key],
      );
      const inserted = saved.rows[0]?.id;
      if (!inserted) {
        const existing = await client.query<{ id: string }>(
          "SELECT id::text FROM human_context.weight_feedback WHERE owner_id = $1 AND client_idempotency_key = $2",
          [ownerId, input.client_idempotency_key],
        );
        return { id: existing.rows[0]?.id ?? "" };
      }
      if (input.action !== "USER_ADDED") {
        await client.query(
          `UPDATE human_context.weight_associations
           SET is_effective = false, superseded_at = clock_timestamp()
           WHERE owner_id = $1 AND target_type = 'TRANSACTION' AND target_id = $2 AND weight_code = $3::human_context.weight_code AND is_effective`,
          [ownerId, transactionId, input.weight_code],
        );
      }
      const next = input.action === "REPLACED" ? input.replaced_weight_code : input.action === "REJECTED" || input.action === "REMOVED" ? null : input.weight_code;
      if (next) {
        await client.query(
          `INSERT INTO human_context.weight_associations (
             owner_id, target_type, target_id, weight_code, is_primary, effective_source, version
           ) VALUES (
             $1, 'TRANSACTION', $2, $3::human_context.weight_code, $4, 'USER_FEEDBACK',
             COALESCE((SELECT MAX(version) + 1 FROM human_context.weight_associations WHERE target_id = $2 AND weight_code = $3::human_context.weight_code), 1)
           )`,
          [ownerId, transactionId, next, input.action !== "USER_ADDED"],
        );
      }
      return { id: inserted };
    });
  }

  async setDecisionMode(ownerId: string, transactionId: string, mode: DecisionMode, annotatedVia: string): Promise<{ mode: DecisionMode }> {
    return this.withOwner(ownerId, async (client) => {
      await this.requireTransaction(client, ownerId, transactionId);
      await client.query(
        `INSERT INTO human_context.decision_mode_annotations (transaction_id, owner_id, mode, annotated_via)
         VALUES ($1, $2, $3::human_context.decision_mode, $4)
         ON CONFLICT (transaction_id) DO UPDATE
         SET mode = EXCLUDED.mode, annotated_via = EXCLUDED.annotated_via, version = human_context.decision_mode_annotations.version + 1`,
        [transactionId, ownerId, mode, annotatedVia],
      );
      return { mode };
    });
  }

  async addReflection(ownerId: string, transactionId: string, input: ReflectionInput): Promise<{ id: string }> {
    return this.withOwner(ownerId, async (client) => {
      await this.requireTransaction(client, ownerId, transactionId);
      const saved = await client.query<{ id: string }>(
        `INSERT INTO human_context.reflections (owner_id, target_type, target_id, reflection_text, weight_feeling, dominant_felt_weight)
         VALUES ($1, 'TRANSACTION', $2, $3, $4, $5::human_context.weight_code)
         RETURNING id::text`,
        [ownerId, transactionId, input.reflection_text, input.weight_feeling, input.dominant_felt_weight],
      );
      return { id: saved.rows[0]?.id ?? "" };
    });
  }

  async transactionContext(ownerId: string, transactionId: string): Promise<TransactionContext | null> {
    return this.withOwner(ownerId, async (client) => {
      const result = await client.query<TransactionContext>(
        `SELECT transaction_id::text, owner_id::text, eligibility_state::text, decision_mode::text,
                effective_weights, reflection_text, weight_feeling
         FROM human_context.v_effective_transaction_context
         WHERE transaction_id = $1 AND owner_id = $2`,
        [transactionId, ownerId],
      );
      return result.rows[0] ?? null;
    });
  }

  private async requireTransaction(client: pg.PoolClient, ownerId: string, transactionId: string): Promise<void> {
    const found = await client.query("SELECT 1 FROM finance.ledger_transactions WHERE id = $1 AND owner_id = $2", [transactionId, ownerId]);
    if (!found.rowCount) throw new Error("transaction_missing");
  }

  async linkForexFees(ownerId: string | null): Promise<{ linked: number }> {
    const result = await this.pool.query<{ link_forex_fees: number }>(
      "SELECT finance.link_forex_fees($1::uuid) AS link_forex_fees",
      [ownerId],
    );
    return { linked: Number(result.rows[0]?.link_forex_fees ?? 0) };
  }

  async read(ownerId: string, bucket: string): Promise<unknown[]> {
    const tables: Record<string, string> = {
      transactions: "ledger_transactions",
      "due-alerts": "due_date_notifications",
      "mutual-funds": "mf_holdings",
      investments: "investment_holdings",
      assets: "asset_holdings",
      debts: "debt_liabilities",
      insurance: "insurance_policies",
    };
    const table = tables[bucket];
    if (!table) return [];
    return this.withOwner(ownerId, async (client) => {
      const result = await client.query(`SELECT * FROM finance.${table} WHERE owner_id = $1`, [ownerId]);
      return result.rows;
    });
  }

  private async withOwner<T>(ownerId: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
      const value = await run(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
