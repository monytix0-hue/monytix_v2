import { latinMonths, type LocalePack } from "./en.js";

/**
 * Spanish bank alerts.
 *
 * Spanish markets differ on the institution but not on the alert wording, so a
 * single pack serves ES and most of LatAm. Mexico and Argentina are the usual
 * exceptions in currency, not in vocabulary.
 */

const months: Record<string, string> = {
  ...latinMonths,
  ene: "01", abr: "04", ago: "08", dic: "12", set: "09",
};

const debitMarks = /\b(?:en|a|para|con|de)\s+/gi;
const creditMarks = /\b(?:de|desde|por)\s+/gi;

export function createSpanishPack(): LocalePack {
  return {
    code: "es",
    language: "es",
    country: "ES",
    months,

    debitVerbs: /\b(?:debitad[oa]|cargad[oa]|pagad[oa]|retirad[oa]|compra|pago|transferencia|cargo)\b/i,
    creditVerbs: /\b(?:acreditad[oa]|recibid[oa]|abonad[oa]|depositad[oa]|reembols[oa]|ingreso)\b/i,
    accountMovement:
      /\b(?:se\s+ha\s+|ha\s+sido\s+)?(?:debitad[oa]|cargad[oa]|acreditad[oa]|abonad[oa])\b|\bsu\s+(?:cuenta|tarjeta)\b|\btarjeta\s+terminada\s+en\s+\d{4}\b/i,
    balanceCue: /\b(?:saldo|saldo\s+disponible|disponible)\b/i,
    disclaimerNoise: /\b(?:phishing|fraude|operación\s+sospechosa)\b/i,
    nonTransactionSubject: [
      /\b(?:clave\s+de\s+un\s+solo\s+uso|código\s+de\s+verificación|otp|clave\s+dinámica)\b/i,
      /\b(?:inicio\s+de\s+sesión|acceso\s+a\s+su\s+cuenta|restablecer\s+contraseña)\b/i,
      /\b(?:extracto|estado\s+de\s+cuenta)\b/i,
      /\b(?:oferta\s+especial|oferta\s+de\s+préstamo|publicidad)\b/i,
    ],
    nonTransactionBody: [
      /este\s+es\s+su\s+código\s+de\s+(?:verificación|seguridad)/i,
      /ha\s+iniciado\s+sesión\s+correctamente/i,
    ],
    boilerplate: [
      /\btarjeta\s+terminada\s+en\s+\d+/i,
      /\bcuenta\s+terminada\s+en\s+\d+/i,
      /nunca\s+comparta/i,
      /atentamente/i,
      /atención\s+al\s+cliente/i,
      /términos\s+y\s+condiciones/i,
      /todos\s+los\s+derechos\s+reservados/i,
      /correo\s+generado\s+automáticamente/i,
      /no\s+responda\s+a\s+este/i,
      /darse\s+de\s+baja|desuscribir/i,
    ],
    counterpartyStop: /\b(?:el|la|los|las|del|en|con|ref|concepto|saldo)\b|[.,]/i,
    debitCounterpartyMark: debitMarks,
    creditCounterpartyMark: creditMarks,
    weakMerchant: /^(?:el|la|los|las|un|una|y|o|su|hoy|ayer|mañana)$/i,
    ownAccountPhrase: /^(?:su\s+)?(?:cuenta|tarjeta|tarjeta\s+de\s+crédito)(?:\s+terminada\s+en\s+\d{4})?$/i,
    vpaPattern: null,
    defaultTimezone: "Europe/Madrid",
    searchTerms: ["debitado", "cargado", "pagado", "compra", "pago", "transferencia", "abono"],
  };
}
