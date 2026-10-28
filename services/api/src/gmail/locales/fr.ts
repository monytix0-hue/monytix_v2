import { latinMonths, type LocalePack } from "./en.js";

/**
 * French bank alerts.
 *
 * French writes amounts with a space or a comma as the decimal mark and often
 * puts the currency after the number ("12,99 EUR"). The amount reader handles
 * that; this pack only owns the vocabulary.
 */

const months: Record<string, string> = {
  ...latinMonths,
  janv: "01", févr: "02", fev: "02", mars: "03", avr: "04", mai: "05", juin: "06",
  juil: "07", août: "08", aout: "08", sept: "09", oct: "10", nov: "11", déc: "12", dec: "12",
};

const debitMarks = /\b(?:chez|à|au|pour|d'un montant de)\s+/gi;
const creditMarks = /\b(?:de|provenant de|par)\s+/gi;

export function createFrenchPack(): LocalePack {
  return {
    code: "fr",
    language: "fr",
    country: "FR",
    months,

    debitVerbs: /\b(?:débité|debite|prélevé|preleve|payé|paye|retiré|retire|achat|paiement|virement)\b/i,
    creditVerbs: /\b(?:crédité|credite|reçu|recu|remboursé|rembourse|déposé|depose|versement)\b/i,
    accountMovement:
      /\b(?:a\s+été\s+|a\s+ete\s+)?(?:débité|debite|crédité|credite|prélevé|preleve)\b|\b(?:votre\s+compte|votre\s+carte|carte\s+se\s+terminant)\b|\bse\s+terminant\s+par\s+\d{4}\b/i,
    balanceCue: /\b(?:solde|solde\s+disponible|disponible)\b/i,
    disclaimerNoise: /\b(?:hameçonnage|phishing|opération\s+suspecte)\b/i,
    nonTransactionSubject: [
      /\b(?:mot\s+de\s+passe\s+à\s+usage\s+unique|code\s+de\s+vérification|otp|certicode)\b/i,
      /\b(?:connexion|identifiez-vous|réinitialisation\s+du\s+mot\s+de\s+passe)\b/i,
      /\b(?:relevé\s+de\s+compte|relevé\s+mensuel)\b/i,
      /\b(?:offre\s+spéciale|offre\s+de\s+prêt|publicité)\b/i,
    ],
    nonTransactionBody: [
      /voici\s+votre\s+code\s+de\s+(?:vérification|confirmation)/i,
      /vous\s+êtes\s+bien\s+connecté/i,
    ],
    boilerplate: [
      /\bcompte\s+se\s+terminant\s+par\s+\d+/i,
      /ne\s+communiquez\s+(?:jamais|en\s+aucun\s+cas)/i,
      /cordialement/i,
      /service\s+client/i,
      /conditions\s+générales/i,
      /tous\s+droits\s+réservés/i,
      /e-?mail\s+généré\s+automatiquement/i,
      /ne\s+pas\s+répondre/i,
      /désabonner|se\s+désabonner/i,
    ],
    counterpartyStop: /\b(?:le|la|les|du|des|au|aux|sur|chez|réf|libellé|solde)\b|[.,]/i,
    debitCounterpartyMark: debitMarks,
    creditCounterpartyMark: creditMarks,
    weakMerchant: /^(?:le|la|les|un|une|des|et|ou|votre|aujourd|hier|demain)$/i,
    ownAccountPhrase: /^(?:votre\s+)?(?:compte|carte|carte\s+bancaire)(?:\s+se\s+terminant\s+par\s+\d{4})?$/i,
    vpaPattern: null,
    defaultTimezone: "Europe/Paris",
    searchTerms: ["débité", "credité", "payé", "paiement", "achat", "virement", "prélèvement"],
  };
}
