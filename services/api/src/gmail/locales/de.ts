import { latinMonths, type LocalePack } from "./en.js";

/**
 * German bank alerts.
 *
 * The verbs are separated by the participle ("wurde … belastet"), not adjacent,
 * which is why `accountMovement` does not require the words to touch. Writing
 * these as one English-shaped regex produces a parser that fails on every real
 * German alert while passing tests built from invented examples.
 */

const months: Record<string, string> = {
  ...latinMonths,
  // German March is "Mär", and umlauts arrive both raw and MIME-encoded.
  mär: "03", mai: "05", okt: "10", dez: "12", marz: "03",
};

const debitMarks = /\b(?:an|bei|für|von|über)\s+(?:den|die|das|der)?\s*/gi;
const creditMarks = /\b(?:von|durch)\s+/gi;

export function createGermanPack(): LocalePack {
  return {
    code: "de",
    language: "de",
    country: "DE",
    months,

    debitVerbs: /\b(?:belastet|abgebucht|ausgegeben|bezahlt|überwiesen|kauf(?:betrag)?|zahlung)\b/i,
    creditVerbs: /\b(?:gutgeschrieben|eingegangen|erhalten|erstattet|rückerstattung|zahlungseingang)\b/i,
    // "wurde … belastet" / "wurde Ihr Konto … belastet": the participle is the
    // reliable signal, the finite verb may be many words earlier.
    accountMovement:
      /\b(?:belastet|gutgeschrieben|abgebucht)\b|\b(?:ihr|das)\s+konto\b|\bkarte\s+\S*\d{4}\b|\bendet\s+auf\s+\d{4}\b|\bwir\s+haben\s+.+\s+(?:belastet|gutgeschrieben)\b/i,
    balanceCue: /\b(?:kontostand|verfügbar(?:er)?\s+betrag|saldo|neuer\s+saldo)\b/i,
    disclaimerNoise: /\b(?:phishing|betrugsversuch|verdächtige\s+kontobewegung)\b/i,
    nonTransactionSubject: [
      /\b(?:einmal(?:passwort|kennwort)|otp|tan|verifizierungscode|bestätigungscode)\b/i,
      /\b(?:anmeldung|login|passwort\s+(?:geändert|zurückgesetzt))\b/i,
      /\b(?:kontoauszug|monatlicher\s+auszug|jahresauszug)\b/i,
      /\b(?:kreditkartenangebot|sonderangebot|werbung)\b/i,
    ],
    nonTransactionBody: [
      /ist\s+ihr\s+(?:einmalpasswort|verifizierungscode)/i,
      /haben\s+sie\s+sich\s+erfolgreich\s+angemeldet/i,
    ],
    boilerplate: [
      /\bkonto\s+endet\s+auf\s+\d+/i,
      /geben\s+sie\s+(?:niemals|nie)\s+(?:ihre[mn]?\s+)?(?:pin|tan|passwort)/i,
      /mit\s+freundlichen\s+grüßen/i,
      /kundenservice/i,
      /allgemeinen\s+geschäftsbedingungen/i,
      /\ball[ae]?\s+rechte\s+vorbehalten/i,
      /diese\s+(?:e-?mail|nachricht)\s+wurde\s+automatisch/i,
      /bitte\s+antworten\s+sie\s+nicht/i,
      /abmelden|vom\s+newsletter\s+abmelden/i,
    ],
    counterpartyStop: /\b(?:am|vom|bei|für|mit|ref|verwendungszweck|karten(?:nummer)?|kontostand|saldo)\b|[.,]/i,
    debitCounterpartyMark: debitMarks,
    creditCounterpartyMark: creditMarks,
    weakMerchant: /^(?:der|die|das|und|oder|ihre|ihr|heute|gestern|morgen)$/i,
    ownAccountPhrase: /^(?:ihr[e]?\s+)?(?:konto|karte|girokonto|kreditkarte)(?:\s+endet\s+auf\s+\d{4})?$/i,
    vpaPattern: null,
    // German bank mail is read in the market's own zone unless the owner set one.
    defaultTimezone: "Europe/Berlin",
    searchTerms: ["belastet", "gutgeschrieben", "abbuchung", "zahlung", "kartenzahlung", "überweisung"],
  };
}
