import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type {
  OwnerPreferences,
  PreferencesPatch,
  PreferencesStore,
  PreferencesWarning,
} from "../src/preferences/index.js";
import { signToken } from "./auth-fixture.js";

/**
 * A store that keeps one owner's row in memory. The route contract is what is
 * under test here; the SQL is exercised by the migration test.
 */
function fakeStore(initial: OwnerPreferences, held: string[] = ["INR"]): PreferencesStore & { writes: PreferencesPatch[] } {
  let current = { ...initial };
  const writes: PreferencesPatch[] = [];
  return {
    writes,
    async read() {
      return { ...current };
    },
    async heldCurrencies() {
      return held;
    },
    async write(_ownerId, patch) {
      writes.push(patch);
      const warnings: PreferencesWarning[] = [];
      if (patch.defaultCurrencyCode !== undefined) {
        const code = patch.defaultCurrencyCode.trim().toUpperCase();
        if (!["INR", "USD", "EUR", "GBP", "AED"].includes(code)) {
          return { ok: false, error: "invalid_currency" };
        }
        current = { ...current, defaultCurrencyCode: code };
        if (!held.includes(code)) {
          warnings.push({ code: "no_account_in_currency", message: `No account in ${code}.`, currency: code });
        }
      }
      if (patch.timezoneName !== undefined) {
        const zone = patch.timezoneName.trim();
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: zone });
        } catch {
          return { ok: false, error: "invalid_timezone" };
        }
        current = { ...current, timezoneName: zone };
      }
      if (patch.countryCode !== undefined) {
        current = { ...current, countryCode: patch.countryCode };
      }
      if (patch.locale !== undefined) {
        current = { ...current, locale: patch.locale };
      }
      return { ok: true, preferences: { ...current }, warnings };
    },
    async close() {},
  };
}

async function appWith(store: PreferencesStore | null) {
  const { options } = await signToken({ subject: "user-1", expiresIn: "1h" });
  return buildApp({
    ...options,
    manualTransactions: null,
    categoryChoices: null,
    ledger: null,
    imports: null,
    objectStorage: null,
    preferences: store,
  });
}

async function token(): Promise<string> {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  return signed.token;
}

const basePreferences: OwnerPreferences = {
  defaultCurrencyCode: "INR",
  timezoneName: "Asia/Kolkata",
  countryCode: "IN",
  locale: "en-IN",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

test("preferences require a bearer token", async () => {
  const app = await appWith(fakeStore(basePreferences));
  const anonymous = await app.inject({ method: "GET", url: "/v1/owner/preferences" });
  assert.equal(anonymous.statusCode, 401);
  await app.close();
});

test("a read returns the preferences with the currencies actually held", async () => {
  const app = await appWith(fakeStore(basePreferences, ["INR", "USD"]));
  const auth = await token();
  const response = await app.inject({
    method: "GET",
    url: "/v1/owner/preferences",
    headers: { authorization: `Bearer ${auth}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    preferences: OwnerPreferences;
    held_currencies: string[];
    is_default_currency: boolean;
  };
  assert.equal(body.preferences.defaultCurrencyCode, "INR");
  assert.equal(body.preferences.timezoneName, "Asia/Kolkata");
  assert.deepEqual(body.held_currencies, ["INR", "USD"]);
  // Default currency with a non-INR account means the owner is multi-currency,
  // so the first-run confirmation must still fire.
  assert.equal(body.is_default_currency, false);
  await app.close();
});

test("a patch is applied and validated", async () => {
  const store = fakeStore(basePreferences);
  const app = await appWith(store);
  const auth = await token();
  const response = await app.inject({
    method: "PATCH",
    url: "/v1/owner/preferences",
    headers: { authorization: `Bearer ${auth}`, "x-monytix-owner-id": "owner-allowed" },
    payload: { default_currency_code: "usd", timezone_name: "Europe/Berlin", country_code: "DE" },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { preferences: OwnerPreferences; warnings: PreferencesWarning[] };
  assert.equal(body.preferences.defaultCurrencyCode, "USD");
  assert.equal(body.preferences.timezoneName, "Europe/Berlin");
  assert.equal(body.preferences.countryCode, "DE");
  // The owner holds no USD account, so the response warns rather than refusing.
  assert.equal(body.warnings.some((warning) => warning.code === "no_account_in_currency"), true);
  await app.close();
});

test("rejected values never reach the store", async () => {
  const store = fakeStore(basePreferences);
  const app = await appWith(store);
  const auth = await token();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ default_currency_code: "XYZ" }, "invalid_currency"],
    [{ default_currency_code: 42 }, "invalid_currency"],
    [{ timezone_name: "Mars/Olympus" }, "invalid_timezone"],
    [{ timezone_name: null }, "invalid_timezone"],
    [{ country_code: "IND" }, "invalid_country"],
    [{ country_code: 7 }, "invalid_country"],
    [{ locale: "not a locale" }, "invalid_locale"],
    [{}, "empty_patch"],
  ];
  for (const [payload, expected] of cases) {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/owner/preferences",
      headers: { authorization: `Bearer ${auth}`, "x-monytix-owner-id": "owner-allowed" },
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal((response.json() as { error: string }).error, expected, JSON.stringify(payload));
  }
  assert.equal(store.writes.length, 0);
  await app.close();
});

test("clearing the country is allowed and stores null", async () => {
  const store = fakeStore(basePreferences);
  const app = await appWith(store);
  const auth = await token();
  const response = await app.inject({
    method: "PATCH",
    url: "/v1/owner/preferences",
    headers: { authorization: `Bearer ${auth}`, "x-monytix-owner-id": "owner-allowed" },
    payload: { country_code: null },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { preferences: OwnerPreferences };
  assert.equal(body.preferences.countryCode, null);
  await app.close();
});

test("preference validation helpers match the database constraints", async () => {
  const { isValidTimeZone, isValidLocale, isSupportedCurrency, countryCodePattern } = await import(
    "../src/preferences/index.js"
  );
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
  assert.equal(isValidTimeZone("Europe/Berlin"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);

  assert.equal(isValidLocale("en-IN"), true);
  assert.equal(isValidLocale("de-DE"), true);
  assert.equal(isValidLocale("not a locale"), false);

  assert.equal(isSupportedCurrency("INR"), true);
  assert.equal(isSupportedCurrency("USD"), true);
  assert.equal(isSupportedCurrency("XYZ"), false);
  // Real ISO codes that collide with common words are still valid currencies.
  assert.equal(isSupportedCurrency("TRY"), true);

  assert.equal(countryCodePattern.test("IN"), true);
  assert.equal(countryCodePattern.test("in"), false);
  assert.equal(countryCodePattern.test("IND"), false);
});
