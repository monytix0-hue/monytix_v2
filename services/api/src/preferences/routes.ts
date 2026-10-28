import type { FastifyPluginAsync } from "fastify";
import type { CurrencyDirectory } from "./currencies.js";
import {
  countryCodePattern,
  isSupportedCurrency,
  isValidLocale,
  isValidTimeZone,
  type PreferencesPatch,
  type PreferencesStore,
} from "./store.js";

/**
 * `GET`/`PATCH /v1/owner/preferences`.
 *
 * A preference change is metadata, never a ledger write: no canonical row's
 * `amount` or `currency_code` moves when the home currency changes. Only display
 * conversion changes, which is why `PATCH` also returns the currencies the owner
 * actually holds — the client can then say "these totals are converted" instead
 * of implying the numbers were always in the new currency.
 */
export const preferencesRoutes: FastifyPluginAsync<{
  store: PreferencesStore | null;
  currencies?: CurrencyDirectory | null;
}> = async (app, options) => {
  const store = options.store;
  const currencies = options.currencies ?? null;

  async function guard(
    actorId: string | null | undefined,
    ownerId: string | null | undefined,
  ): Promise<"ok" | "unauthorized" | "owner_forbidden" | "unavailable"> {
    if (!actorId) return "unauthorized";
    if (!ownerId) return "owner_forbidden";
    if (!store) return "unavailable";
    return "ok";
  }

  app.get("/v1/owner/preferences", async (request, reply) => {
    const status = await guard(request.actorId, request.ownerId);
    if (status !== "ok") {
      return reply.status(status === "unavailable" ? 503 : status === "unauthorized" ? 401 : 403).send({
        error: status === "unavailable" ? "preferences_unavailable" : status,
      });
    }
    const preferences = await store!.read(request.ownerId!);
    if (!preferences) {
      return reply.status(404).send({ error: "owner_not_found" });
    }
    // `held_currencies` lets the client warn on a mismatch without a second call.
    const held = await store!.heldCurrencies(request.ownerId!);
    return {
      contract: "owner-preferences-v0.1",
      preferences,
      held_currencies: held,
      // True while the owner has never changed the currency away from the column
      // default, which is what the first-run confirmation checks.
      is_default_currency: preferences.defaultCurrencyCode === "INR" && held.every((code) => code === "INR"),
    };
  });

  app.patch("/v1/owner/preferences", async (request, reply) => {
    const status = await guard(request.actorId, request.ownerId);
    if (status !== "ok") {
      return reply.status(status === "unavailable" ? 503 : status === "unauthorized" ? 401 : 403).send({
        error: status === "unavailable" ? "preferences_unavailable" : status,
      });
    }

    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.status(400).send({ error: "invalid_body" });
    }
    const record = body as Record<string, unknown>;
    const patch: PreferencesPatch = {};

    if (Object.prototype.hasOwnProperty.call(record, "default_currency_code")) {
      if (typeof record.default_currency_code !== "string") {
        return reply.status(400).send({ error: "invalid_currency" });
      }
      patch.defaultCurrencyCode = record.default_currency_code;
    }
    if (Object.prototype.hasOwnProperty.call(record, "timezone_name")) {
      if (typeof record.timezone_name !== "string") {
        return reply.status(400).send({ error: "invalid_timezone" });
      }
      patch.timezoneName = record.timezone_name;
    }
    if (Object.prototype.hasOwnProperty.call(record, "country_code")) {
      const value = record.country_code;
      if (value !== null && typeof value !== "string") {
        return reply.status(400).send({ error: "invalid_country" });
      }
      patch.countryCode = value as string | null;
    }
    if (Object.prototype.hasOwnProperty.call(record, "locale")) {
      const value = record.locale;
      if (value !== null && typeof value !== "string") {
        return reply.status(400).send({ error: "invalid_locale" });
      }
      patch.locale = value as string | null;
    }

    if (Object.keys(patch).length === 0) {
      return reply.status(400).send({ error: "empty_patch" });
    }

    // Cheap shape checks first, so a malformed body never reaches the store.
    if (patch.defaultCurrencyCode !== undefined) {
      const code = patch.defaultCurrencyCode.trim().toUpperCase();
      if (!isSupportedCurrency(code)) {
        return reply.status(400).send({ error: "invalid_currency" });
      }
    }
    if (patch.timezoneName !== undefined && !isValidTimeZone(patch.timezoneName.trim())) {
      return reply.status(400).send({ error: "invalid_timezone" });
    }
    if (patch.countryCode !== undefined && patch.countryCode !== null && patch.countryCode !== "") {
      if (!countryCodePattern.test(patch.countryCode.trim().toUpperCase())) {
        return reply.status(400).send({ error: "invalid_country" });
      }
    }
    if (patch.locale !== undefined && patch.locale !== null && patch.locale !== "") {
      if (!isValidLocale(patch.locale.trim())) {
        return reply.status(400).send({ error: "invalid_locale" });
      }
    }

    const written = await store!.write(request.ownerId!, patch);
    if (!written.ok) {
      const status = written.error === "owner_not_found" ? 404 : 400;
      return reply.status(status).send({ error: written.error });
    }

    const held = await store!.heldCurrencies(request.ownerId!);
    return {
      contract: "owner-preferences-v0.1",
      preferences: written.preferences,
      held_currencies: held,
      warnings: written.warnings,
    };
  });

  /**
   * `GET /v1/currencies` — the formatting facts, for a client that would rather
   * read a table than ship a copy of ISO 4217.
   *
   * Public within the authenticated surface: it is reference data, not owner
   * data, so it never varies by owner and can be cached for the process lifetime.
   */
  app.get("/v1/currencies", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!currencies) {
      return reply.status(503).send({ error: "currencies_unavailable" });
    }
    return {
      contract: "currency-directory-v0.1",
      currencies: await currencies.list(),
    };
  });

  /**
   * `GET /v1/currencies/:code` — one row, for the "currency uncertain — review"
   * screen that needs to show what the detected code will look like.
   */
  app.get<{ Params: { code: string } }>("/v1/currencies/:code", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!currencies) {
      return reply.status(503).send({ error: "currencies_unavailable" });
    }
    const code = (request.params.code ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return reply.status(400).send({ error: "invalid_currency" });
    }
    return {
      contract: "currency-directory-v0.1",
      currency: await currencies.get(code),
    };
  });
};
