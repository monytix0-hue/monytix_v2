import { latinMonths, type LocalePack } from "./en.js";

/**
 * Portuguese bank alerts, for Portugal and Brazil.
 *
 * The two markets split on currency and on the word for a card ("cartão" in both,
 * but "conta à ordem" in PT against "conta corrente" in BR), not on the verbs, so
 * one pack covers both and the country signal decides the currency.
 */

const months: Record<string, string> = {
  ...latinMonths,
  fev: "02", mai: "05", ago: "08", out: "10", dez: "12", set: "09",
};

const debitMarks = /\b(?:em|no|na|para|com|de)\s+/gi;
const creditMarks = /\b(?:de|do|da|por)\s+/gi;

export function createPortuguesePack(): LocalePack {
  return {
    code: "pt",
    language: "pt",
    country: "PT",
    months,

    debitVerbs: /\b(?:debitad[oa]|debitou|cobrad[oa]|pag[oa]|levantad[oa]|compra|pagamento|transferência)\b/i,
    creditVerbs: /\b(?:creditad[oa]|recebid[oa]|depositad[oa]|reembolsad[oa]|entrada)\b/i,
    accountMovement:
      /\b(?:foi\s+)?(?:debitad[oa]|creditad[oa]|cobrad[oa])\b|\bsua\s+(?:conta|conta\s+à\s+ordem|conta\s+corrente|cartão)\b|\bcartão\s+terminado\s+em\s+\d{4}\b/i,
    balanceCue: /\b(?:saldo|saldo\s+disponível|disponível)\b/i,
    disclaimerNoise: /\b(?:phishing|fraude|movimento\s+suspeito)\b/i,
    nonTransactionSubject: [
      /\b(?:código\s+de\s+utilização\s+única|código\s+de\s+verificação|otp|chave\s+dinâmica)\b/i,
      /\b(?:início\s+de\s+sessão|entrou\s+na\s+sua\s+conta|redefinir\s+palavra-passe)\b/i,
      /\b(?:extrato|extrato\s+mensal)\b/i,
      /\b(?:oferta\s+especial|oferta\s+de\s+crédito|publicidade)\b/i,
    ],
    nonTransactionBody: [
      /este\s+é\s+o\s+seu\s+código\s+de\s+(?:verificação|segurança)/i,
      /sessão\s+iniciada\s+com\s+sucesso/i,
    ],
    boilerplate: [
      /\bcartão\s+terminado\s+em\s+\d+/i,
      /\bconta\s+terminada\s+em\s+\d+/i,
      /nunca\s+partilhe|nunca\s+compartilhe/i,
      /com\s+os\s+melhores\s+cumprimentos/i,
      /atendimento\s+ao\s+cliente|serviço\s+de\s+apoio\s+ao\s+cliente/i,
      /termos\s+e\s+condições/i,
      /todos\s+os\s+direitos\s+reservados/i,
      /e-?mail\s+gerado\s+automaticamente/i,
      /não\s+responda\s+a\s+este/i,
      /cancelar\s+a\s+subscrição|descadastrar/i,
    ],
    counterpartyStop: /\b(?:o|a|os|as|do|da|em|no|na|com|ref|descrição|saldo)\b|[.,]/i,
    debitCounterpartyMark: debitMarks,
    creditCounterpartyMark: creditMarks,
    weakMerchant: /^(?:o|a|os|as|um|uma|e|ou|seu|sua|hoje|ontem|amanhã)$/i,
    ownAccountPhrase: /^(?:seu|sua\s+)?(?:conta|cartão)(?:\s+terminad[oa]\s+em\s+\d{4})?$/i,
    vpaPattern: null,
    defaultTimezone: "Europe/Lisbon",
    searchTerms: ["debitado", "creditado", "pagamento", "compra", "transferência", "cobrança"],
  };
}
