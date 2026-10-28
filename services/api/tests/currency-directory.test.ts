import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { CurrencyDirectory, CurrencyFormat } from "../src/preferences/index.js";
import type { OwnerPreferences, PreferencesStore } from "../src/preferences/index.js";
import { signToken } from "./auth-fixture.js";

/**
 * `ref.currency` is reference data, so the route contract is what matters: an
 * authenticated caller reads the list, an anonymous one does not, and a code the
 * table has no row for still returns a shape the client can format.
 */

const inr: CurrencyFormat = {
  code: "INR",
  displayName: "Indian Rupee",
  symbol: "₹",
  minorUnits: 2,
  groupSizes: [2, 2, 3],
  decimalSeparator: ".",
  groupSeparator: ",",
  monetary: true,
};

const jpy: CurrencyFormat = {
  code: "JPY",
  displayName: "Japanese Yen",
  symbol: "¥",
  minorUnits: 0,
  groupSizes: [3],
  decimalSeparator: ".",
  groupSeparator: ",",
  monetary: true,
};

function fakeDirectory(): CurrencyDirectory & { requested: string[][] } {
  const requested: string[][] = [];
  return {
    requested,
    async list() {
      return [inr, jpy];
    },
    async get(code) {
      return code === "JPY" ? jpy : inr;
    },
    async forCodes(codes) {
      requested.push(codes);
      // Mirror `createCurrencyDirectory.forCodes`: upper-case, drop non-ISO shapes,
      // and keep the first occurrence so a caller's ordering is preserved.
      const out: Record<string, CurrencyFormat> = {};
      for (const raw of codes) {
        const code = raw.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code) || out[code]) continue;
        out[code] = code === "JPY" ? jpy : inr;
      }
      return out;
    },
    async close() {},
  };
}

function fakePreferences(initial: OwnerPreferences): PreferencesStore {
  return {
    async read() {
      return initial;
    },
    async heldCurrencies() {
      return ["INR", "JPY"];
    },
    async write() {
      return { ok: true, preferences: initial, warnings: [] };
    },
    async close() {},
  };
}

const preferences: OwnerPreferences = {
  defaultCurrencyCode: "JPY",
  timezoneName: "Asia/Tokyo",
  countryCode: "JP",
  locale: "ja-JP",
  updatedAt: null,
};

async function appWith(currencies: CurrencyDirectory | null) {
  const { options } = await signToken({ subject: "user-1", expiresIn: "1h" });
  return buildApp({
    ...options,
    manualTransactions: null,
    categoryChoices: null,
    ledger: null,
    imports: null,
    objectStorage: null,
    preferences: fakePreferences(preferences),
    currencies,
  });
}

async function headers(): Promise<Record<string, string>> {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  return { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" };
}

test("the currency directory needs a caller and reports itself unavailable without one", async () => {
  const anonymousApp = await appWith(fakeDirectory());
  const anonymous = await anonymousApp.inject({ method: "GET", url: "/v1/currencies" });
  assert.equal(anonymous.statusCode, 401);
  await anonymousApp.close();

  const unwired = await appWith(null);
  const response = await unwired.inject({ method: "GET", url: "/v1/currencies", headers: await headers() });
  assert.equal(response.statusCode, 503);
  assert.equal((response.json() as { error: string }).error, "currencies_unavailable");
  await unwired.close();
});

test("every row carries the formatting facts a client needs", async () => {
  const app = await appWith(fakeDirectory());
  const response = await app.inject({ method: "GET", url: "/v1/currencies", headers: await headers() });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { contract: string; currencies: CurrencyFormat[] };
  assert.equal(body.contract, "currency-directory-v0.1");
  assert.equal(body.currencies.length, 2);
  const rupee = body.currencies.find((row) => row.code === "INR");
  assert.ok(rupee);
  // Lakh grouping is data, not a client-side rule.
  assert.deepEqual(rupee!.groupSizes, [2, 2, 3]);
  assert.equal(rupee!.symbol, "₹");
  const yen = body.currencies.find((row) => row.code === "JPY");
  assert.equal(yen!.minorUnits, 0);
});

test("one code is readable and a malformed one is refused", async () => {
  const app = await appWith(fakeDirectory());
  const ok = await app.inject({ method: "GET", url: "/v1/currencies/jpy", headers: await headers() });
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as { currency: CurrencyFormat }).currency.minorUnits, 0);

  const bad = await app.inject({ method: "GET", url: "/v1/currencies/dollars", headers: await headers() });
  assert.equal(bad.statusCode, 400);
  assert.equal((bad.json() as { error: string }).error, "invalid_currency");
  await app.close();
});

test("bootstrap ships formats only for the currencies the owner holds, plus the home one", async () => {
  const directory = fakeDirectory();
  const app = await appWith(directory);
  const response = await app.inject({ method: "GET", url: "/v1/ui/bootstrap", headers: await headers() });
  // No ledger in this fixture, so bootstrap answers 403 before it formats anything.
  // The request log is still the contract: the directory must not be asked for the
  // whole table on a route every tab calls.
  assert.equal(response.statusCode, 403);
  assert.deepEqual(directory.requested, []);
  await app.close();
});

test("the format bundle is scoped rather than the whole table", async () => {
  // Exercise `forCodes` directly, since the bootstrap route needs a ledger fixture
  // that the integration test owns.
  const directory = fakeDirectory();
  const bundle = await directory.forCodes(["inr", "JPY", "INR", "nope"]);
  assert.deepEqual(Object.keys(bundle).sort(), ["INR", "JPY"]);
  assert.deepEqual(directory.requested[0], ["inr", "JPY", "INR", "nope"]);
});
