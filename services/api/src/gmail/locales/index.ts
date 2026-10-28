import { createEnglishIndiaPack, createEnglishPack, type LocalePack } from "./en.js";
import { createGermanPack } from "./de.js";
import { createFrenchPack } from "./fr.js";
import { createSpanishPack } from "./es.js";
import { createPortuguesePack } from "./pt.js";

export type { LocalePack } from "./en.js";

/**
 * Pack resolution.
 *
 * Country wins over language, because an English-speaking owner in Germany gets
 * German bank mail. Only when the country has no pack do we fall back to the
 * language, and only then to plain English.
 *
 * The default is `en-IN`, not `en`: the only mailboxes this pipeline has ever
 * read are Indian, and silently switching them to the looser English pack would
 * change how existing rows parse.
 */

const byCountry = new Map<string, () => LocalePack>([
  ["IN", createEnglishIndiaPack],
  ["DE", createGermanPack],
  ["AT", createGermanPack],
  ["CH", createGermanPack],
  ["FR", createFrenchPack],
  ["BE", createFrenchPack],
  ["ES", createSpanishPack],
  ["MX", createSpanishPack],
  ["AR", createSpanishPack],
  ["CO", createSpanishPack],
  ["CL", createSpanishPack],
  ["PE", createSpanishPack],
  ["PT", createPortuguesePack],
  ["BR", createPortuguesePack],
]);

const byLanguage = new Map<string, () => LocalePack>([
  ["en", createEnglishPack],
  ["de", createGermanPack],
  ["fr", createFrenchPack],
  ["es", createSpanishPack],
  ["pt", createPortuguesePack],
]);

const cache = new Map<string, LocalePack>();

function memo(key: string, make: () => LocalePack): LocalePack {
  const existing = cache.get(key);
  if (existing) return existing;
  const pack = make();
  cache.set(key, pack);
  return pack;
}

export type LocaleHint = {
  /** `core.owner.metadata->>'country_code'`, upper case. */
  country?: string | null;
  /** `core.owner.metadata->>'locale'`, e.g. `de-DE`. Falls back to language only. */
  locale?: string | null;
};

/** The language tag of a locale hint: `de-DE` -> `de`. */
export function languageOf(locale: string | null | undefined): string | null {
  const tag = (locale ?? "").trim().toLowerCase();
  if (!tag) return null;
  const primary = tag.split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/**
 * Resolve the pack for an owner.
 *
 * A region-tagged locale whose country has a pack (`en-IN`, `de-AT`) is honoured
 * first, so an Indian owner keeps the rails even if their metadata lost the
 * country field.
 */
export function resolveLocalePack(hint: LocaleHint = {}): LocalePack {
  const country = (hint.country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) {
    const make = byCountry.get(country);
    if (make) return memo(`c:${country}`, make);
  }

  const tag = (hint.locale ?? "").trim().toLowerCase();
  const region = tag.split(/[-_]/)[1]?.toUpperCase() ?? "";
  if (/^[A-Z]{2}$/.test(region)) {
    const make = byCountry.get(region);
    if (make) return memo(`c:${region}`, make);
  }

  const language = languageOf(hint.locale);
  if (language) {
    const make = byLanguage.get(language);
    if (make) return memo(`l:${language}`, make);
  }

  return memo("default", createEnglishIndiaPack);
}

/** Look a pack up by its own code, for reparse of a stored row. */
export function localePackByCode(code: string): LocalePack {
  const normalized = (code ?? "").trim();
  switch (normalized) {
    case "en-IN": return memo("c:IN", createEnglishIndiaPack);
    case "en": return memo("l:en", createEnglishPack);
    case "de": return memo("l:de", createGermanPack);
    case "fr": return memo("l:fr", createFrenchPack);
    case "es": return memo("l:es", createSpanishPack);
    case "pt": return memo("l:pt", createPortuguesePack);
    default: return memo("default", createEnglishIndiaPack);
  }
}

/**
 * Build a Gmail search query from a pack's verbs.
 *
 * Gmail silently rejects over-long queries, so this is capped. On overflow it
 * falls back to the English set rather than truncating, because a half-built
 * `OR` chain matches nothing.
 */
const maxQueryTerms = 24;

export function searchQueryFor(pack: LocalePack, window = "newer_than:365d"): string {
  const terms = pack.searchTerms.filter((term) => /^[\p{L}\p{N} _-]{2,40}$/u.test(term));
  const chosen = terms.length > 0 && terms.length <= maxQueryTerms
    ? terms
    : createEnglishPack().searchTerms;

  const ors = chosen.map((term) => (term.includes(" ") ? `"${term}"` : term));
  return `${window} -filename:pdf -filename:csv -filename:xls -filename:xlsx (${ors.join(" OR ")})`;
}
