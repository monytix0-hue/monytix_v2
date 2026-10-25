-- One shared decision flow, filled per family from the ledger.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.decision_copy (
    decision_family_code text PRIMARY KEY,
    title                text NOT NULL,
    question             text NOT NULL,
    context              text NOT NULL,
    choices              jsonb NOT NULL,
    solutions            jsonb NOT NULL,
    mattered             text NOT NULL,
    expected_outcomes    jsonb NOT NULL,
    transparency         text NOT NULL,
    optional_note        text NOT NULL
);

INSERT INTO ref.decision_copy (
    decision_family_code, title, question, context, choices, solutions, mattered, expected_outcomes, transparency, optional_note
)
SELECT
    row.code,
    row.title,
    row.question,
    row.context,
    jsonb_build_array(
        jsonb_build_object(
            'id', 'a',
            'name', row.balanced,
            'approach', 'Balanced',
            'amount', row.balanced,
            'meters', jsonb_build_array(
                jsonb_build_object('label', 'Money you keep available', 'fraction', 0.72),
                jsonb_build_object('label', 'Protection you build', 'fraction', 0.58)
            ),
            'outcomes', jsonb_build_array('Most of today''s flexibility stays', 'A measured buffer is added'),
            'hint', 'Tap to select and see how it fits what matters to you'
        ),
        jsonb_build_object(
            'id', 'b',
            'name', row.safety,
            'approach', 'Safety first',
            'amount', row.safety,
            'meters', jsonb_build_array(
                jsonb_build_object('label', 'Money you keep available', 'fraction', 0.46),
                jsonb_build_object('label', 'Protection you build', 'fraction', 0.84)
            ),
            'outcomes', jsonb_build_array('Less cash stays immediately flexible', 'Protection is built first'),
            'hint', 'Tap to select and see how it fits what matters to you'
        ),
        jsonb_build_object(
            'id', 'c',
            'name', row.flex,
            'approach', 'Flexibility first',
            'amount', row.flex,
            'meters', jsonb_build_array(
                jsonb_build_object('label', 'Money you keep available', 'fraction', 0.96),
                jsonb_build_object('label', 'Protection you build', 'fraction', 0.28)
            ),
            'outcomes', jsonb_build_array('Today''s cash stays available', 'The later buffer stays as it is'),
            'hint', 'Tap to select and see how it fits what matters to you'
        )
    ),
    jsonb_build_array(
        jsonb_build_object('title', 'Keep it where it is', 'tag', 'Highest access', 'detail', 'Use an account you already have. No new product is required.'),
        jsonb_build_object('title', 'A short, accessible holding', 'tag', 'Access and some return', 'detail', 'Keeps the money reachable while it sits aside.'),
        jsonb_build_object('title', 'A longer option you can revisit', 'tag', 'Return later', 'detail', 'Only if you want to look again. The decision is already complete.')
    ),
    'The weights you marked highest are the ones this choice carries forward.',
    jsonb_build_array(
        row.title || ' moves with the choice you mark',
        'You can still change your mind before you confirm'
    ),
    'These options follow from the decision you already made. Monytix does not create a Decision because a product is available.',
    'Your Decision is still complete. You can return to these options later.'
FROM (
    VALUES
        ('D1', 'Emergency Fund Allocation', 'How much should you move to your Emergency Buffer?', 'You have flexible cash. Your current buffer is below your preferred level.', 'Move a balanced amount', 'Move the fuller amount', 'Do nothing'),
        ('D2', 'Cash Buffer Top-Up', 'How much idle cash should you add to your cash buffer?', 'Flexible cash is available and the buffer can take more.', 'Add a balanced top-up', 'Fill the buffer first', 'Leave the cash flexible'),
        ('D3', 'Credit Card Payment', 'How do you want to handle this credit card bill?', 'A card bill is due. Paying it changes both comfort and the amount you still owe.', 'Pay a balanced amount', 'Clear the bill', 'Leave it for the due date'),
        ('D4', 'Loan EMI Protection', 'How do you want to protect this loan EMI?', 'An instalment is ahead. Keeping it covered protects the rest of the month.', 'Set aside the next instalment', 'Cover the next few instalments', 'Leave the EMI as scheduled'),
        ('D5', 'Insurance Renewal', 'What should happen at this insurance renewal?', 'A renewal is coming up. Continuing, changing, or waiting are all choices.', 'Renew the current plan', 'Review a stronger plan', 'Decide closer to the date'),
        ('D6', 'Insurance Coverage Gap', 'How do you want to close this insurance gap?', 'The cover you have and the cover you may need are not the same.', 'Close part of the gap', 'Close the gap', 'Keep the current cover'),
        ('D7', 'Idle Cash Deployment', 'Where should this idle cash go?', 'Cash is sitting still. Moving it and leaving it are both choices.', 'Move a portion', 'Put idle cash to work', 'Keep it idle'),
        ('D8', 'Income Surplus Allocation', 'How should this income surplus be split?', 'Income came in above the usual spend. You choose what stays flexible.', 'Split it evenly', 'Direct the surplus onward', 'Keep the surplus flexible'),
        ('D9', 'Recurring Review', 'Which recurring payments should you keep?', 'Regular payments are using cash every cycle.', 'Review the largest ones', 'Pause what you do not need', 'Keep them all for now'),
        ('D10', 'Expense Spike Review', 'How do you want to respond to this expense spike?', 'Spending jumped above the usual pattern.', 'Note it and continue', 'Pull the next month back', 'Treat it as a one-off'),
        ('D11', 'Large Expense Warning', 'How do you want to handle this large expense?', 'This outflow is large enough to deserve a choice before it repeats.', 'Absorb it once', 'Set a limit for the next one', 'Leave it unmarked'),
        ('D12', 'Cash Crunch Forecast', 'How do you want to prepare for this cash crunch?', 'The coming days look tighter than the cash you can use.', 'Set a small cushion', 'Protect the tight days first', 'Wait and see'),
        ('D13', 'Savings Rate Lift', 'How much should you lift your savings rate?', 'A little more can be saved without taking all of today''s flexibility.', 'Lift it slightly', 'Lift it properly', 'Keep the current rate'),
        ('D14', 'Goal Contribution Catch-Up', 'How do you want to catch up this goal contribution?', 'A goal contribution is behind where you intended.', 'Catch up part of it', 'Catch up in full', 'Skip this period'),
        ('D15', 'Salary Day Allocation', 'How should this salary be allocated?', 'Salary day is when the month''s choices are cheapest to make.', 'Follow the usual split', 'Fund safety before spending', 'Leave it unallocated'),
        ('D16', 'Bonus Allocation', 'How should this bonus be split?', 'A bonus is extra. Spending it, saving it, and mixing both are all choices.', 'Split the bonus', 'Save the bonus first', 'Keep it available'),
        ('D17', 'Emergency Fund Milestone Push', 'How hard should you push this emergency fund milestone?', 'The next safety milestone is within reach.', 'Take a step toward it', 'Reach the milestone now', 'Leave the milestone'),
        ('D18', 'SIP Continuity', 'How do you want to keep this SIP going?', 'A regular investment can continue, pause, or wait.', 'Continue as it is', 'Protect the SIP first', 'Pause and review'),
        ('D19', 'Idle Cash to SIP', 'How much idle cash should move into your SIP?', 'Cash that is not needed soon can start a regular investment.', 'Move a small amount', 'Move the surplus', 'Keep the cash'),
        ('D20', 'Asset Drift Rebalance', 'How do you want to correct this asset drift?', 'What you hold has moved away from the mix you intended.', 'Nudge it back', 'Rebalance fully', 'Leave the mix'),
        ('D21', 'Retirement Funding Gap', 'How do you want to close this retirement gap?', 'Later income and what is being set aside do not yet match.', 'Add a small contribution', 'Close more of the gap', 'Leave the plan unchanged'),
        ('D22', 'Goal-Linked Investing', 'How should this goal be invested?', 'A goal can stay in cash or be invested toward its date.', 'Invest part of it', 'Invest toward the goal', 'Keep the goal in cash'),
        ('D23', 'Dining Optimization', 'How do you want to handle dining spend?', 'Eating out is using the comfort weight more than the usual month.', 'Keep dining, with a cap', 'Cook more of the meals', 'Leave dining as it is'),
        ('D24', 'Shopping Control', 'How do you want to handle shopping?', 'Shopping is taking a larger share of flexible cash.', 'Pause non-essential buys', 'Set a shopping cap', 'Keep shopping freely'),
        ('D25', 'Entertainment Cap', 'How do you want to cap entertainment spend?', 'Entertainment subscriptions and outings are adding up.', 'Keep one main subscription', 'Cap entertainment this month', 'Leave it uncapped'),
        ('D26', 'Travel Spend Review', 'How do you want to handle this travel spend?', 'Travel is a choice between the trip and the cash it uses.', 'Keep the essential parts', 'Reduce the trip cost', 'Leave the plan unchanged'),
        ('D27', 'Discretionary Squeeze', 'How tightly should discretionary spend be squeezed?', 'Flexible spending can be tightened without touching obligations.', 'Tighten it a little', 'Squeeze non-essentials', 'Do not squeeze'),
        ('D28', 'Mission Acceleration', 'How do you want to accelerate this mission?', 'A mission can move faster if you give it more of this month.', 'Add one extra step', 'Bring the date forward', 'Stay on the current pace'),
        ('D29', 'Confidence Growth Opportunity', 'Which growth step do you want to take?', 'There is room to grow without giving up the safety you already have.', 'Take a small step', 'Use the surplus to grow', 'Wait for a clearer month'),
        ('D30', 'Milestone Unlock', 'How do you want to use this milestone?', 'A milestone is unlocked. You choose whether to mark it or build on it.', 'Mark it and continue', 'Put the next step in motion', 'Leave it for later')
) AS row(code, title, question, context, balanced, safety, flex)
ON CONFLICT (decision_family_code) DO UPDATE
SET title = EXCLUDED.title,
    question = EXCLUDED.question,
    context = EXCLUDED.context,
    choices = EXCLUDED.choices,
    solutions = EXCLUDED.solutions,
    mattered = EXCLUDED.mattered,
    expected_outcomes = EXCLUDED.expected_outcomes,
    transparency = EXCLUDED.transparency,
    optional_note = EXCLUDED.optional_note;

UPDATE ref.decision_copy
   SET choices = jsonb_build_array(
           jsonb_build_object(
               'id', 'a', 'name', 'Move ₹4,000', 'approach', 'Balanced', 'amount', '₹4,000',
               'meters', jsonb_build_array(
                   jsonb_build_object('label', 'Money you keep available', 'fraction', 0.78),
                   jsonb_build_object('label', 'Emergency protection', 'fraction', 0.58)
               ),
               'outcomes', jsonb_build_array('₹37,400 remains flexible', '46 safety days'),
               'hint', 'Tap to select and see how it fits what matters to you'
           ),
           jsonb_build_object(
               'id', 'b', 'name', 'Move ₹8,500', 'approach', 'Safety first', 'amount', '₹8,500',
               'meters', jsonb_build_array(
                   jsonb_build_object('label', 'Money you keep available', 'fraction', 0.6),
                   jsonb_build_object('label', 'Emergency protection', 'fraction', 0.82)
               ),
               'outcomes', jsonb_build_array('₹32,900 remains flexible', '61 safety days'),
               'hint', 'Tap to select and see how it fits what matters to you'
           ),
           jsonb_build_object(
               'id', 'c', 'name', 'Do nothing', 'approach', 'Flexibility first', 'amount', 'Do nothing',
               'meters', jsonb_build_array(
                   jsonb_build_object('label', 'Money you keep available', 'fraction', 1),
                   jsonb_build_object('label', 'Emergency protection', 'fraction', 0.3)
               ),
               'outcomes', jsonb_build_array('₹41,400 remains flexible', '24 safety days'),
               'hint', 'Tap to select and see how it fits what matters to you'
           )
       ),
       question = 'How much should you move to your Emergency Buffer?',
       context = 'You have ₹41,400 flexible. Your current buffer is below your preferred level.',
       mattered = 'Resilience and Risk mattered more to you than preserving all of today''s Comfort.',
       expected_outcomes = jsonb_build_array(
           'Emergency Buffer: the chosen amount is set aside',
           'Flexible cash falls by the amount you move'
       )
 WHERE decision_family_code = 'D1';

CREATE OR REPLACE FUNCTION ops.publish_movement_decision(p_logical uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = action, ref, core, spendsense, ops, pg_temp
AS $publish$
DECLARE
    v_owner uuid;
    v_category text;
    v_subcategory text;
    v_flow text;
    v_amount numeric;
    v_merchant text;
    v_state text;
    v_primary text;
    v_code text;
    v_family uuid;
    v_copy ref.decision_copy%ROWTYPE;
    v_eval uuid;
    v_band text;
    v_key text;
BEGIN
    IF p_logical IS NULL THEN
        RETURN;
    END IF;
    SELECT o.owner_id, cv.direction, cv.amount, coalesce(nullif(btrim(cv.raw_description), ''), 'This movement'),
           mw.eligibility_state, mw.primary_weight_code::text,
           choice.category_code, choice.subcategory_code
      INTO v_owner, v_flow, v_amount, v_merchant, v_state, v_primary, v_category, v_subcategory
      FROM core.logical_transaction lt
      JOIN core.canonical_transaction_version cv
        ON cv.logical_transaction_id = lt.logical_transaction_id AND cv.is_current
      JOIN core.movement_weight mw ON mw.logical_transaction_id = lt.logical_transaction_id
      JOIN core.account_ownership o ON o.financial_account_id = lt.financial_account_id
      LEFT JOIN core.category_choice choice ON choice.logical_transaction_id = lt.logical_transaction_id
     WHERE lt.logical_transaction_id = p_logical
       AND o.relationship_status = 'ACTIVE'
       AND o.effective_to IS NULL
     ORDER BY choice.is_explicit DESC,
              CASE WHEN o.relationship_role = 'PRIMARY_HOLDER' THEN 0 ELSE 1 END
     LIMIT 1;
    IF v_owner IS NULL OR upper(coalesce(v_flow, '')) <> 'OUT' THEN
        RETURN;
    END IF;
    IF v_state NOT IN ('WEIGHT', 'PROMOTE') THEN
        RETURN;
    END IF;
    IF v_subcategory = 'PEER_TO_PEER' OR v_category = 'TRANSFER' THEN
        RETURN;
    END IF;

    v_code := CASE v_subcategory
        WHEN 'CREDIT_CARD_BILL' THEN 'D3'
        WHEN 'LOAN_EMI' THEN 'D4'
        WHEN 'SIP_AUTO_DEBIT' THEN 'D18'
        WHEN 'RENT' THEN 'D9'
        WHEN 'COFFEE_AND_CAFES' THEN 'D23'
        WHEN 'RESTAURANT_DINE_IN' THEN 'D23'
        WHEN 'FOOD_DELIVERY' THEN 'D23'
        WHEN 'GROCERIES_SUPERMARKET' THEN 'D24'
        WHEN 'STREAMING_SUBSCRIPTIONS' THEN 'D25'
        WHEN 'TRANSIT_CABS' THEN 'D26'
        WHEN 'TRANSIT_FUEL' THEN 'D26'
        WHEN 'TRAVEL_RAILWAYS' THEN 'D26'
        WHEN 'AIRLINE_TRAVEL' THEN 'D26'
        ELSE NULL
    END;
    IF v_code IS NULL AND v_state = 'PROMOTE' THEN
        v_code := 'D11';
    ELSIF v_code IS NULL THEN
        v_code := CASE v_primary
            WHEN 'W09_RESILIENCE' THEN 'D1'
            WHEN 'W04_OBLIGATIONS' THEN 'D9'
            WHEN 'W02_COMFORT' THEN 'D23'
            WHEN 'W07_OPPORTUNITY' THEN 'D7'
            WHEN 'W08_ATTENTION' THEN 'D10'
            WHEN 'W03_RISK' THEN 'D5'
            WHEN 'W01_TIME' THEN 'D11'
            WHEN 'W10_LEGACY' THEN 'D18'
            WHEN 'W05_IDENTITY' THEN 'D24'
            ELSE NULL
        END;
    END IF;
    IF v_code IS NULL THEN
        RETURN;
    END IF;

    SELECT * INTO v_copy FROM ref.decision_copy WHERE decision_family_code = v_code;
    SELECT decision_family_version_id INTO v_family
      FROM ref.decision_family
     WHERE decision_family_code = v_code AND status = 'ACTIVE'
     ORDER BY definition_version DESC
     LIMIT 1;
    IF v_family IS NULL OR v_copy.decision_family_code IS NULL THEN
        RETURN;
    END IF;

    v_band := CASE WHEN v_state = 'PROMOTE' THEN 'HIGH' ELSE 'MODERATE' END;
    v_key := 'movement-family:' || v_code;

    INSERT INTO action.decision_evaluation (
        owner_id, decision_family_version_id, eligibility_status, priority_band,
        trigger_type, option_set, idempotency_key, decision_score
    ) VALUES (
        v_owner, v_family, 'ELIGIBLE', v_band, 'TRANSACTION_PROMOTE',
        coalesce(v_copy.choices, '[]'::jsonb), 'movement-eval:' || v_code, coalesce(v_amount, 0)
    )
    ON CONFLICT (owner_id, idempotency_key) DO UPDATE
       SET priority_band = EXCLUDED.priority_band,
           option_set = EXCLUDED.option_set,
           decision_score = EXCLUDED.decision_score,
           evaluated_at = clock_timestamp()
    RETURNING decision_evaluation_id INTO v_eval;

    INSERT INTO action.decision (
        owner_id, decision_family_version_id, source_evaluation_id, origin_type, state, title,
        trigger_summary, option_set, current_rank, current_priority_band, idempotency_key
    ) VALUES (
        v_owner, v_family, v_eval, 'SYSTEM_EVALUATED', 'CANDIDATE', v_copy.title,
        jsonb_build_object(
            'amount', v_amount,
            'merchant', v_merchant,
            'question', v_copy.question,
            'context', v_copy.context,
            'weight_count', 3
        ),
        coalesce(v_copy.choices, '[]'::jsonb),
        1, v_band, v_key
    )
    ON CONFLICT (owner_id, idempotency_key) DO UPDATE
       SET trigger_summary = EXCLUDED.trigger_summary,
           option_set = EXCLUDED.option_set,
           source_evaluation_id = EXCLUDED.source_evaluation_id,
           current_priority_band = EXCLUDED.current_priority_band,
           updated_at = clock_timestamp()
     WHERE action.decision.state NOT IN ('SELECTED', 'EXECUTED');
END;
$publish$;

REVOKE ALL ON FUNCTION ops.publish_movement_decision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.publish_movement_decision(uuid) TO monytix_api;

CREATE OR REPLACE FUNCTION ops.record_movement_weight(p_logical uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $record$
DECLARE
    v_owner uuid;
    v_category text;
    v_subcategory text;
    v_channel text;
    v_flow text;
    v_amount numeric;
    v_state text;
    v_reason text;
    v_primary text;
    v_secondary text;
BEGIN
    IF p_logical IS NULL THEN
        RETURN;
    END IF;
    SELECT o.owner_id
      INTO v_owner
      FROM core.logical_transaction lt
      JOIN core.account_ownership o ON o.financial_account_id = lt.financial_account_id
     WHERE lt.logical_transaction_id = p_logical
       AND o.relationship_status = 'ACTIVE'
       AND o.effective_to IS NULL
     ORDER BY CASE WHEN o.relationship_role = 'PRIMARY_HOLDER' THEN 0 ELSE 1 END
     LIMIT 1;
    IF v_owner IS NULL THEN
        RETURN;
    END IF;
    SELECT choice.category_code, choice.subcategory_code
      INTO v_category, v_subcategory
      FROM core.category_choice choice
     WHERE choice.logical_transaction_id = p_logical
     ORDER BY choice.is_explicit DESC
     LIMIT 1;
    SELECT cv.direction, cv.amount, s.channel
      INTO v_flow, v_amount, v_channel
      FROM core.canonical_transaction_version cv
      LEFT JOIN core.gmail_spot_transaction s ON s.logical_transaction_id = cv.logical_transaction_id
     WHERE cv.logical_transaction_id = p_logical
       AND cv.is_current
     LIMIT 1;
    IF v_flow IS NULL THEN
        RETURN;
    END IF;
    SELECT assigned.eligibility_state, assigned.reason_code, assigned.primary_weight_code, assigned.secondary_weight_code
      INTO v_state, v_reason, v_primary, v_secondary
      FROM spendsense.assign_movement_weight(v_category, v_subcategory, v_channel, v_flow, v_amount) assigned;
    INSERT INTO core.movement_weight (
        logical_transaction_id, owner_id, eligibility_state, reason_code, primary_weight_code, secondary_weight_code
    ) VALUES (
        p_logical, v_owner, v_state, v_reason,
        v_primary::human_context.weight_code,
        v_secondary::human_context.weight_code
    )
    ON CONFLICT (logical_transaction_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           eligibility_state = EXCLUDED.eligibility_state,
           reason_code = EXCLUDED.reason_code,
           primary_weight_code = EXCLUDED.primary_weight_code,
           secondary_weight_code = EXCLUDED.secondary_weight_code,
           updated_at = clock_timestamp();
    PERFORM ops.publish_movement_decision(p_logical);
END;
$record$;

CREATE OR REPLACE FUNCTION ops.format_inr(p_amount numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $inr$
DECLARE
    v_whole text;
    v_last text;
    v_rest text;
BEGIN
    IF p_amount IS NULL THEN
        RETURN NULL;
    END IF;
    v_whole := trunc(abs(p_amount))::bigint::text;
    IF length(v_whole) <= 3 THEN
        RETURN '₹' || v_whole;
    END IF;
    v_last := right(v_whole, 3);
    v_rest := left(v_whole, length(v_whole) - 3);
    WHILE length(v_rest) > 2 LOOP
        v_last := right(v_rest, 2) || ',' || v_last;
        v_rest := left(v_rest, length(v_rest) - 2);
    END LOOP;
    RETURN '₹' || v_rest || ',' || v_last;
END;
$inr$;

CREATE OR REPLACE FUNCTION ops.phone_decision_board(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $board$
    WITH cards AS (
        SELECT d.decision_id::text AS id,
               coalesce(d.title, c.title, f.decision_family_code) AS title,
               coalesce(d.trigger_summary->>'question', c.question, d.title) AS question,
               coalesce(d.trigger_summary->>'context', c.context) AS context,
               CASE
                   WHEN d.state IN ('SELECTED', 'EXECUTED') THEN 'made'
                   WHEN d.expires_at IS NOT NULL AND d.expires_at > clock_timestamp() THEN 'upcoming'
                   ELSE 'need_you'
               END AS state,
               CASE
                   WHEN jsonb_typeof(d.trigger_summary->'amount') = 'number'
                       THEN ops.format_inr((d.trigger_summary->>'amount')::numeric)
                   ELSE NULL
               END AS amount_text,
               coalesce(d.option_set, c.choices, '[]'::jsonb) AS choices,
               coalesce(e.decision_score, 0) AS score
          FROM action.decision d
          JOIN ref.decision_family f ON f.decision_family_version_id = d.decision_family_version_id
          LEFT JOIN ref.decision_copy c ON c.decision_family_code = f.decision_family_code
          LEFT JOIN action.decision_evaluation e ON e.decision_evaluation_id = d.source_evaluation_id
         WHERE d.owner_id = p_owner
           AND d.state IN ('CANDIDATE', 'PRESENTED', 'CONSIDERING', 'SELECTED', 'EXECUTED')
    ),
    shaped AS (
        SELECT id, title, question, context, state, amount_text, choices, score,
               CASE state
                   WHEN 'upcoming' THEN 'Saved for later'
                   WHEN 'made' THEN 'Marked'
                   ELSE 'Needs a choice'
               END AS timing,
               CASE state
                   WHEN 'upcoming' THEN 'UPCOMING'
                   WHEN 'made' THEN 'MARKED'
                   ELSE 'NEEDS A CHOICE'
               END AS badge,
               (
                   SELECT string_agg(choice->>'name', ' · ' ORDER BY ordinality)
                     FROM jsonb_array_elements(choices) WITH ORDINALITY AS choice(choice, ordinality)
               ) AS summary
          FROM cards
    ),
    featured AS (
        SELECT * FROM shaped WHERE state = 'need_you' ORDER BY score DESC, title LIMIT 1
    )
    SELECT jsonb_build_object(
        'contract', 'ui-decisions-v0.1',
        'empty_state', NOT EXISTS (SELECT 1 FROM shaped),
        'active_decision_count', (SELECT count(*) FROM shaped WHERE state = 'need_you'),
        'heaviest', coalesce(
            (SELECT jsonb_build_object(
                'available', true,
                'id', id,
                'title', title,
                'question', question,
                'context', context,
                'amount', amount_text,
                'timing', timing,
                'state', state,
                'badge', badge,
                'summary', summary,
                'weight_count', jsonb_array_length(choices),
                'choices', choices
            ) FROM featured),
            jsonb_build_object('available', false)
        ),
        'decisions', coalesce(
            (SELECT jsonb_agg(jsonb_build_object(
                'id', s.id,
                'title', s.title,
                'question', s.question,
                'context', s.context,
                'amount', s.amount_text,
                'timing', s.timing,
                'state', s.state,
                'badge', s.badge,
                'summary', s.summary,
                'weight_count', jsonb_array_length(s.choices),
                'choices', s.choices
            ) ORDER BY s.score DESC, s.title)
               FROM shaped s
              WHERE NOT EXISTS (SELECT 1 FROM featured f WHERE f.id = s.id)),
            '[]'::jsonb
        )
    );
$board$;

CREATE OR REPLACE FUNCTION ops.phone_decision_screen(p_owner uuid, p_decision uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $screen$
    SELECT jsonb_build_object(
        'decision', jsonb_build_object(
            'id', d.decision_id::text,
            'title', coalesce(c.title, d.title),
            'question', coalesce(c.question, d.trigger_summary->>'question', d.title),
            'context', coalesce(c.context, d.trigger_summary->>'context'),
            'mattered', c.mattered,
            'expected', coalesce(c.expected_outcomes, '[]'::jsonb)
        ),
        'tradeoff', jsonb_build_object(
            'eyebrow', 'THE TRADE-OFF',
            'title', 'What are you balancing?',
            'description', 'Every option moves the balance between money you can use now and protection you build for later.'
        ),
        'choices', coalesce(c.choices, d.option_set, '[]'::jsonb),
        'weights', jsonb_build_array(
            jsonb_build_object('name', 'Resilience', 'priority', CASE WHEN 'W09_RESILIENCE' = ANY(f.primary_weight_codes) THEN 'HIGH' ELSE 'MEDIUM' END, 'meaning', 'Protection you can count on later', 'importance', CASE WHEN 'W09_RESILIENCE' = ANY(f.primary_weight_codes) THEN 0.9 ELSE 0.45 END),
            jsonb_build_object('name', 'Risk', 'priority', CASE WHEN 'W03_RISK' = ANY(f.primary_weight_codes) THEN 'HIGH' ELSE 'MEDIUM' END, 'meaning', 'How exposed this choice leaves you', 'importance', CASE WHEN 'W03_RISK' = ANY(f.primary_weight_codes) THEN 0.9 ELSE 0.45 END),
            jsonb_build_object('name', 'Comfort', 'priority', CASE WHEN 'W02_COMFORT' = ANY(f.primary_weight_codes) THEN 'HIGH' ELSE 'MEDIUM' END, 'meaning', 'Money you can still use now', 'importance', CASE WHEN 'W02_COMFORT' = ANY(f.primary_weight_codes) THEN 0.9 ELSE 0.45 END),
            jsonb_build_object('name', 'Opportunity', 'priority', CASE WHEN 'W07_OPPORTUNITY' = ANY(f.primary_weight_codes) THEN 'HIGH' ELSE 'MEDIUM' END, 'meaning', 'Room to grow what you set aside', 'importance', CASE WHEN 'W07_OPPORTUNITY' = ANY(f.primary_weight_codes) THEN 0.9 ELSE 0.45 END)
        ),
        'solutions', coalesce(c.solutions, '[]'::jsonb),
        'transparency', c.transparency,
        'optional_note', c.optional_note
    )
      FROM action.decision d
      JOIN ref.decision_family f ON f.decision_family_version_id = d.decision_family_version_id
      LEFT JOIN ref.decision_copy c ON c.decision_family_code = f.decision_family_code
     WHERE d.owner_id = p_owner
       AND d.decision_id = p_decision;
$screen$;

REVOKE ALL ON FUNCTION ops.phone_decision_board(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_decision_screen(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.phone_decision_board(uuid) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_decision_screen(uuid, uuid) TO monytix_api, monytix_finance;
GRANT SELECT ON ref.decision_copy TO monytix_api, monytix_finance;

DO $check$
DECLARE
    v_count integer;
    v_question text;
BEGIN
    SELECT count(*) INTO v_count FROM ref.decision_copy;
    IF v_count <> 30 THEN
        RAISE EXCEPTION 'decision copy count failed: %', v_count;
    END IF;
    SELECT question INTO v_question FROM ref.decision_copy WHERE decision_family_code = 'D1';
    IF v_question IS DISTINCT FROM 'How much should you move to your Emergency Buffer?' THEN
        RAISE EXCEPTION 'emergency fund copy failed: %', v_question;
    END IF;
    IF ops.format_inr(41400) IS DISTINCT FROM '₹41,400' OR ops.format_inr(4000) IS DISTINCT FROM '₹4,000' THEN
        RAISE EXCEPTION 'rupee format failed: % / %', ops.format_inr(41400), ops.format_inr(4000);
    END IF;
END;
$check$;

DO $backfill$
DECLARE
    v_logical uuid;
BEGIN
    FOR v_logical IN
        SELECT logical_transaction_id
          FROM core.movement_weight
         WHERE eligibility_state IN ('WEIGHT', 'PROMOTE')
    LOOP
        PERFORM ops.publish_movement_decision(v_logical);
    END LOOP;
END;
$backfill$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'DECISION-SCREENS',
    'Publish one decision card per family and store the shared screen copy',
    'OQ-11-open',
    'decision-screens',
    'D01-D30 share Weigh, Confirm, and Next step. A ledger weight publishes the matching family.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
