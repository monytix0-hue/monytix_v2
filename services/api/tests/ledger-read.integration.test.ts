import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { createFirebaseVerifier } from "../src/auth/verifier.js";
import { createLedgerRead } from "../src/ledger/read.js";
import { testKeys, testProjectId } from "./auth-fixture.js";

const apiUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;

test("ledger reads stay inside the authenticated owner", async (t) => {
  if (!apiUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const stamp = Date.now().toString();
  const keys = await testKeys();
  async function tokenFor(subject: string) {
    return new SignJWT({ auth_time: Math.floor(Date.now() / 1000) })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(`https://securetoken.google.com/${testProjectId}`)
      .setAudience(testProjectId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);
  }
  async function owner(name: string, type: "PERSON" | "BUSINESS") {
    const row = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name) VALUES ($2, $1) RETURNING owner_id`,
      [name, type],
    );
    return row.rows[0]!.owner_id;
  }
  async function account(name: string, currency: string) {
    const row = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', $1, $2, 'ACTIVE') RETURNING financial_account_id`,
      [name, currency],
    );
    return row.rows[0]!.financial_account_id;
  }
  async function version(accountId: string, date: string, amount: string, currency: string, direction: "IN" | "OUT", duplicate = "DISTINCT") {
    const logical = await admin.query<{ logical_transaction_id: string }>(
      "INSERT INTO core.logical_transaction (financial_account_id) VALUES ($1) RETURNING logical_transaction_id",
      [accountId],
    );
    const logicalId = logical.rows[0]!.logical_transaction_id;
    const inserted = await admin.query<{ canonical_transaction_version_id: string }>(
      `INSERT INTO core.canonical_transaction_version (
         logical_transaction_id, version_no, is_current, financial_account_id,
         transaction_date, amount, direction, currency_code, raw_description,
         extraction_sequence, normalization_status, normalization_confidence,
         normalization_version, change_provenance, duplicate_outcome, reversal_indicator
       ) VALUES (
         $1, 1, false, $2, $3::date, $4::numeric, $5, $6, $7,
         1, 'READY', 0, 'ledger-read-v0.1', 'MIGRATION_CORRECTION', $8, false
       ) RETURNING canonical_transaction_version_id`,
      [logicalId, accountId, date, amount, direction, currency, `desc-${date}-${amount}`, duplicate],
    );
    const versionId = inserted.rows[0]!.canonical_transaction_version_id;
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [versionId]);
    return { logicalId, versionId };
  }
  try {
    const subjectA = `ledger-a-${stamp}`;
    const subjectB = `ledger-b-${stamp}`;
    const actorA = (await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", subjectA, null],
    )).rows[0]!.provision_authenticated_actor;
    const actorB = (await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", subjectB, null],
    )).rows[0]!.provision_authenticated_actor;
    const personal = await owner(`Personal ${stamp}`, "PERSON");
    const business = await owner(`Business ${stamp}`, "BUSINESS");
    const denied = await owner(`Denied ${stamp}`, "BUSINESS");
    const other = await owner(`Other ${stamp}`, "PERSON");
    const personalAccount = await account(`Personal ${stamp}`, "INR");
    const businessAccount = await account(`Business ${stamp}`, "INR");
    const otherAccount = await account(`Other ${stamp}`, "INR");
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($3, $4, 'BUSINESS_OWNER', 'VERIFIED', 'ACTIVE'),
              ($5, $6, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
      [personal, personalAccount, business, businessAccount, other, otherAccount],
    );
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true), ($1, $3, 'OWNER', 'ACTIVE', false), ($4, $5, 'OWNER', 'ACTIVE', true)`,
      [actorA, personal, business, actorB, other],
    );
    const first = await version(personalAccount, "2026-01-01", "1.0000", "INR", "IN");
    const second = await version(personalAccount, "2026-01-02", "2.0000", "INR", "OUT");
    const third = await version(personalAccount, "2026-01-03", "3.0000", "INR", "IN");
    const loan = await version(personalAccount, "2026-02-01", "50.0000", "INR", "OUT");
    const card = await version(personalAccount, "2026-02-02", "40.0000", "INR", "OUT");
    await version(personalAccount, "2026-02-03", "7.0000", "USD", "OUT");
    await version(personalAccount, "2026-02-04", "99.0000", "INR", "OUT", "EQUIVALENT_SUPERSEDED");
    const old = await admin.query<{ canonical_transaction_version_id: string }>(
      `INSERT INTO core.canonical_transaction_version (
         logical_transaction_id, version_no, is_current, financial_account_id,
         transaction_date, amount, direction, currency_code, raw_description,
         extraction_sequence, normalization_status, normalization_confidence,
         normalization_version, change_provenance, duplicate_outcome, reversal_indicator
       ) VALUES (
         $1, 2, false, $2, DATE '2026-01-01', 100.0000, 'IN', 'INR', 'replaced',
         2, 'READY', 0, 'ledger-read-v0.1', 'MIGRATION_CORRECTION', 'DISTINCT', false
       ) RETURNING canonical_transaction_version_id`,
      [first.logicalId, personalAccount],
    );
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [old.rows[0]!.canonical_transaction_version_id]);
    await version(personalAccount, "2026-10-05", "11.0000", "INR", "IN");
    await version(personalAccount, "2026-10-06", "4.0000", "INR", "OUT");
    await version(businessAccount, "2026-01-15", "8.0000", "INR", "IN");
    await version(otherAccount, "2026-01-20", "70.0000", "INR", "IN");
    await admin.query(
      `INSERT INTO intel.financial_event_resolution (
         logical_transaction_id, canonical_transaction_version_id, rulebook_version,
         matched_rule_code, precedence_band, resolution_outcome, event_family
       ) VALUES
         ($1, $2, 'F10D-v1.2', 'EMI_001', 'P1', 'RESOLVED', 'LOAN_REPAYMENT'),
         ($3, $4, 'F10D-v1.2', 'CC_001', 'P1', 'RESOLVED', 'CREDIT_CARD_PAYMENT')`,
      [loan.logicalId, loan.versionId, card.logicalId, card.versionId],
    );
    const loanEvent = await admin.query<{ financial_event_resolution_id: string }>(
      `SELECT financial_event_resolution_id
         FROM intel.financial_event_resolution
        WHERE logical_transaction_id = $1`,
      [loan.logicalId],
    );
    await admin.query(
      `INSERT INTO intel.category_resolution (
         logical_transaction_id, financial_event_resolution_id, canonical_transaction_version_id,
         taxonomy_version, category_code, subcategory_code, category_status
       ) VALUES ($1, $2, $3, 'F10E-v1.2', 'FINANCIAL_SERVICES', 'LOAN_EMI', 'RESOLVED')`,
      [loan.logicalId, loanEvent.rows[0]!.financial_event_resolution_id, loan.versionId],
    );
    await admin.query(
      `INSERT INTO core.category_choice (
         owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
       ) VALUES ($1, $2, 'FOOD_DINING', 'FOOD_DELIVERY', 'ZOMATO', 'EXACT_MERCHANT', false)`,
      [personal, second.logicalId],
    );
    await admin.query(
      `INSERT INTO core.balance_snapshot (financial_account_id, observed_at, balance_type, balance_amount, currency_code, source_quality)
       VALUES ($1, timestamptz '2026-02-01', 'AVAILABLE', 15.0000, 'INR', 'OBSERVED')`,
      [personalAccount],
    );

    const verify = await createFirebaseVerifier({ projectId: testProjectId, publicKeyPem: keys.publicKeyPem });
    const app = await buildApp({
      logger: false,
      auth: { configured: true, verify },
      identity: createPgIdentity(apiUrl),
      ledger: createLedgerRead(apiUrl),
    });
    const tokenA = await tokenFor(subjectA);
    const tokenB = await tokenFor(subjectB);
    const headers = (token: string, ownerId?: string) => ({
      authorization: `Bearer ${token}`,
      ...(ownerId ? { "x-monytix-owner-id": ownerId } : {}),
    });

    const page = await app.inject({ method: "GET", url: "/v1/transactions?limit=2", headers: headers(tokenA) });
    assert.equal(page.statusCode, 200);
    const firstPage = page.json() as { items: Array<{ logicalTransactionId: string; amount: string; transactionDate: string }>; nextCursor: string | null };
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.items[0]!.transactionDate >= firstPage.items[1]!.transactionDate, true);
    const next = await app.inject({
      method: "GET",
      url: `/v1/transactions?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      headers: headers(tokenA),
    });
    const secondPage = next.json() as { items: Array<{ logicalTransactionId: string }> };
    assert.equal(secondPage.items.some((item) => item.logicalTransactionId === firstPage.items[0]!.logicalTransactionId), false);

    const filtered = await app.inject({
      method: "GET",
      url: `/v1/transactions?direction=OUT&from=2026-02-01&to=2026-02-28&accountId=${personalAccount}`,
      headers: headers(tokenA),
    });
    const filteredBody = filtered.json() as { items: Array<{ amount: string; currency: string; direction: string; financialEvent: { family: string } | null }> };
    assert.deepEqual(filteredBody.items.map((item) => item.direction), filteredBody.items.map(() => "OUT"));
    assert.equal(filteredBody.items.some((item) => item.amount.startsWith("99")), false);
    assert.equal(filteredBody.items.some((item) => item.amount.startsWith("100")), false);
    assert.equal(filteredBody.items.some((item) => item.financialEvent?.family === "LOAN_REPAYMENT"), true);
    assert.equal(filteredBody.items.some((item) => item.currency.trim() === "USD"), true);

    const otherView = await app.inject({ method: "GET", url: "/v1/transactions", headers: headers(tokenB) });
    const otherItems = (otherView.json() as { items: Array<{ accountId: string }> }).items;
    const otherSummaries = await app.inject({ method: "GET", url: "/v1/accounts/summaries", headers: headers(tokenB) });
    const otherSummary = (otherSummaries.json() as { accounts: Array<{ accountId: string; availableBalance: unknown }> }).accounts.find((account) => account.accountId === otherAccount);
    assert.equal(otherSummary?.availableBalance ?? null, null);
    assert.equal(otherItems.every((item) => item.accountId === otherAccount), true);
    assert.equal(otherItems.some((item) => item.accountId === personalAccount), false);

    const deniedView = await app.inject({ method: "GET", url: "/v1/transactions", headers: headers(tokenA, denied) });
    assert.equal(deniedView.statusCode, 403);

    const businessView = await app.inject({ method: "GET", url: "/v1/transactions", headers: headers(tokenA, business) });
    const businessItems = (businessView.json() as { items: Array<{ accountId: string }> }).items;
    assert.equal(businessItems.every((item) => item.accountId === businessAccount), true);

    const summaries = await app.inject({ method: "GET", url: "/v1/accounts/summaries", headers: headers(tokenA) });
    const summaryBody = summaries.json() as { accounts: Array<{ accountId: string; availableBalance: { amount: string } | null; totals: Array<{ currency: string; inflow: string }> }> };
    const personalSummary = summaryBody.accounts.find((account) => account.accountId === personalAccount);
    assert.equal(personalSummary?.availableBalance?.amount.startsWith("15"), true);
    const businessSummary = summaryBody.accounts.find((account) => account.accountId === businessAccount);
    assert.equal(businessSummary, undefined);
    assert.equal(summaryBody.accounts.some((account) => account.accountId === otherAccount), false);
    const inr = personalSummary?.totals.find((total) => total.currency.trim() === "INR");
    const usd = personalSummary?.totals.find((total) => total.currency.trim() === "USD");
    assert.equal(Boolean(inr && usd), true);
    assert.notEqual(inr?.currency.trim(), usd?.currency.trim());

    const overview = await app.inject({
      method: "GET",
      url: "/v1/finance/overview?from=2026-02-01&to=2026-02-28&currency=INR",
      headers: headers(tokenA),
    });
    const overviewBody = overview.json() as { currencies: Array<{ currency: string; outflow: string; ordinaryOutflow: string; events: Array<{ family: string | null }> }> };
    assert.equal(overviewBody.currencies.length, 1);
    assert.equal(overviewBody.currencies[0]!.currency.trim(), "INR");
    assert.equal(Number(overviewBody.currencies[0]!.outflow), 90);
    assert.equal(Number(overviewBody.currencies[0]!.ordinaryOutflow), 0);
    assert.equal(overviewBody.currencies[0]!.events.some((event) => event.family === "LOAN_REPAYMENT"), true);

    const insights = await app.inject({
      method: "GET",
      url: "/v1/ledger/insights?from=2026-02-01&to=2026-02-28&currency=INR",
      headers: headers(tokenA),
    });
    assert.equal(insights.statusCode, 200);
    const insightsBody = insights.json() as {
      contract: string;
      uncategorised: number;
      monthlySummary: Array<{ month: string; credit: string; debit: string; openingBalance: string; closingBalance: string }>;
      spendingAnalysis: { categories: Record<string, { name: string; totalAmount: string; subcategories: Record<string, string> }> };
    };
    assert.equal(insightsBody.contract, "ledger-insights-v0.1");
    assert.deepEqual(insightsBody.monthlySummary.map((row) => row.month), ["2026-02"]);
    assert.equal(Number(insightsBody.monthlySummary[0]!.debit), 90);
    assert.equal(Number(insightsBody.monthlySummary[0]!.credit), 0);
    // Closing balance comes from the observed snapshot; opening rolls back through the month's flows.
    assert.equal(Number(insightsBody.monthlySummary[0]!.closingBalance), 15);
    assert.equal(Number(insightsBody.monthlySummary[0]!.openingBalance), 105);
    const pieTotal = Object.values(insightsBody.spendingAnalysis.categories).reduce((sum, row) => sum + Number(row.totalAmount), 0);
    assert.equal(pieTotal, Number(insightsBody.monthlySummary[0]!.debit));
    assert.equal(Number(insightsBody.spendingAnalysis.categories.FINANCIAL_SERVICES?.subcategories.LOAN_EMI), 50);
    assert.equal(Number(insightsBody.spendingAnalysis.categories.none?.totalAmount), 40);
    assert.equal(insightsBody.uncategorised > 0, true);

    const usdInsights = await app.inject({
      method: "GET",
      url: "/v1/ledger/insights?from=2026-02-01&to=2026-02-28&currency=USD",
      headers: headers(tokenA),
    });
    const usdBody = usdInsights.json() as { monthlySummary: Array<{ debit: string }>; spendingAnalysis: { categories: Record<string, { totalAmount: string }> } };
    assert.equal(Number(usdBody.monthlySummary[0]!.debit), 7);
    assert.equal(Number(usdBody.spendingAnalysis.categories.none?.totalAmount), 7);

    const food = await app.inject({
      method: "GET",
      url: "/v1/transactions?category=FOOD_DINING",
      headers: headers(tokenA),
    });
    const foodItems = (food.json() as { items: Array<{ logicalTransactionId: string; categoryCode: string | null; categoryName: string | null; subcategoryCode: string | null; subcategoryName: string | null }> }).items;
    assert.deepEqual(foodItems.map((item) => item.logicalTransactionId), [second.logicalId]);
    assert.equal(foodItems[0]?.categoryName, "Food & Dining");
    assert.equal(foodItems[0]?.subcategoryCode, "FOOD_DELIVERY");
    assert.equal(foodItems[0]?.subcategoryName, "Food delivery");

    const uncategorized = await app.inject({
      method: "GET",
      url: "/v1/transactions?category=none",
      headers: headers(tokenA),
    });
    const uncategorizedIds = (uncategorized.json() as { items: Array<{ logicalTransactionId: string }> }).items.map((item) => item.logicalTransactionId);
    assert.equal(uncategorizedIds.includes(second.logicalId), false);
    assert.equal(uncategorizedIds.includes(loan.logicalId), false);

    const emi = await app.inject({
      method: "GET",
      url: "/v1/transactions?subcategory=LOAN_EMI",
      headers: headers(tokenA),
    });
    const emiItems = (emi.json() as { items: Array<{ logicalTransactionId: string; subcategoryName: string | null; accountName: string | null }> }).items;
    assert.deepEqual(emiItems.map((item) => item.logicalTransactionId), [loan.logicalId]);
    assert.equal(emiItems[0]?.subcategoryName, "Loan EMI and NBFC debits");
    assert.equal(emiItems[0]?.accountName, `Personal ${stamp}`);

    const foodUnset = await app.inject({
      method: "GET",
      url: "/v1/transactions?category=FOOD_DINING&subcategory=none",
      headers: headers(tokenA),
    });
    assert.deepEqual(
      (foodUnset.json() as { items: Array<{ logicalTransactionId: string }> }).items.map((item) => item.logicalTransactionId),
      [],
    );
    const foodDelivery = await app.inject({
      method: "GET",
      url: "/v1/transactions?category=FOOD_DINING&subcategory=FOOD_DELIVERY",
      headers: headers(tokenA),
    });
    assert.deepEqual(
      (foodDelivery.json() as { items: Array<{ logicalTransactionId: string }> }).items.map((item) => item.logicalTransactionId),
      [second.logicalId],
    );

    const filters = await app.inject({ method: "GET", url: "/v1/transaction-filters", headers: headers(tokenA) });
    const filterBody = filters.json() as { categories: Array<{ code: string; subcategories: Array<{ code: string }> }> };
    assert.equal(filterBody.categories.some((row) => row.code === "FOOD_DINING" && row.subcategories.some((sub) => sub.code === "FOOD_DELIVERY")), true);
    assert.equal(filterBody.categories.some((row) => row.code === "FINANCIAL_SERVICES" && row.subcategories.some((sub) => sub.code === "LOAN_EMI")), true);
    assert.equal(filterBody.categories.some((row) => row.code === "none"), true);

    const badCategory = await app.inject({ method: "GET", url: "/v1/transactions?category=food", headers: headers(tokenA) });
    assert.equal(badCategory.statusCode, 422);

    const unknown = await app.inject({ method: "GET", url: "/v1/transactions?from=2026-01-01&to=2026-01-01", headers: headers(tokenA) });
    const unknownItem = (unknown.json() as { items: Array<{ financialUse: { categoryCode: string | null } | null }> }).items[0];
    assert.equal(unknownItem?.financialUse?.categoryCode ?? null, null);

    const monthIn = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(tokenA), "content-type": "application/json" },
      payload: { question: "How much money came in this month?" },
    });
    const monthBody = monthIn.json() as { available: boolean; currencies: Array<{ currency: string; amount: string }> };
    assert.equal(monthBody.available, true);
    assert.equal(Number(monthBody.currencies.find((row) => row.currency.trim() === "INR")?.amount), 11);

    const loans = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(tokenA), "content-type": "application/json" },
      payload: { question: "What were my loan repayments?" },
    });
    const loanBody = loans.json() as { items: Array<{ logicalTransactionId: string }> };
    assert.deepEqual(loanBody.items.map((item) => item.logicalTransactionId), [loan.logicalId]);

    const otherBot = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(tokenB), "content-type": "application/json" },
      payload: { question: "What were my loan repayments?" },
    });
    assert.equal((otherBot.json() as { available: boolean }).available, false);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(tokenA), "content-type": "application/json" },
      payload: { question: "What is my projected balance?" },
    });
    assert.equal((missing.json() as { available: boolean }).available, false);

    await app.close();
  } finally {
    await admin.end();
  }
});
