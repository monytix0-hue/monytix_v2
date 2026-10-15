import type { Interest } from "./site";

export type RegistrationKind = "waitlist" | "contact";

export type RegistrationInput = {
  kind: RegistrationKind;
  interest: Interest | null;
  fullName: string;
  email: string;
  country: string | null;
  businessName: string | null;
  message: string | null;
  consent: boolean;
  sourcePage: string;
  companyWebsite: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

export function parseRegistration(body: unknown): { ok: true; value: RegistrationInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "That form could not be read." };
  const raw = body as Record<string, unknown>;
  const kind = raw.kind === "contact" ? "contact" : raw.kind === "waitlist" ? "waitlist" : null;
  if (!kind) return { ok: false, error: "Choose how you would like to get in touch." };

  const interestRaw = clean(raw.interest, 20);
  const interest =
    interestRaw === "personal" || interestRaw === "business" || interestRaw === "both" ? interestRaw : null;
  if (kind === "waitlist" && !interest) {
    return { ok: false, error: "Choose Personal, Business, or Both." };
  }

  const fullName = clean(raw.fullName, 120);
  if (fullName.length < 2) return { ok: false, error: "Add your full name." };

  const email = clean(raw.email, 180).toLowerCase();
  if (!emailPattern.test(email)) return { ok: false, error: "Enter a valid email address." };

  const country = clean(raw.country, 80) || null;
  const message = clean(raw.message, 2000) || null;
  if (kind === "contact" && !message) return { ok: false, error: "Add a short message." };

  const consent = raw.consent === true;
  if (!consent) return { ok: false, error: "Consent is required before we can keep your details." };

  let businessName = clean(raw.businessName, 160) || null;
  if (kind !== "waitlist" || (interest !== "business" && interest !== "both")) businessName = null;

  let sourcePage = clean(raw.sourcePage, 200);
  if (!sourcePage.startsWith("/")) sourcePage = "/";

  return {
    ok: true,
    value: {
      kind,
      interest: kind === "waitlist" ? interest : null,
      fullName,
      email,
      country,
      businessName,
      message: kind === "contact" ? message : null,
      consent,
      sourcePage,
      companyWebsite: clean(raw.companyWebsite, 200),
    },
  };
}

const hits = new Map<string, number[]>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (hits.get(ip) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= 8) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}
