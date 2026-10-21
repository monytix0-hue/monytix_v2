import type { AaClient } from "./app.js";

export function aaClientFromEnv(env: NodeJS.ProcessEnv = process.env): AaClient | null {
  const base = env.AA_GATEWAY_URL?.trim() || env.AA_BASE_URL?.trim() || "";
  const apiKey = env.AA_CLIENT_API_KEY?.trim() ?? "";
  const clientId = env.AA_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.AA_CLIENT_SECRET?.trim() ?? "";
  const fiuId = env.AA_FIU_ID?.trim() || "MONYTIX_FIU";
  if (!base) return null;
  if (apiKey) return new HttpAaClient(base.replace(/\/$/, ""), apiKey, fiuId);
  if (clientId && clientSecret) return new HttpAaClient(base.replace(/\/$/, ""), clientSecret, fiuId, clientId);
  return null;
}

export class HttpAaClient implements AaClient {
  constructor(
    private readonly base: string,
    private readonly apiKey: string,
    private readonly fiuId = "MONYTIX_FIU",
    private readonly clientId = "",
  ) {}

  async createConsent(ownerId: string): Promise<{ consent_id: string; redirect_url: string }> {
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    const body = await this.post("/consents", {
      owner_id: ownerId,
      fiu_id: this.fiuId,
      consent_duration_days: 365,
      date_range: { from: from.toISOString(), to: to.toISOString() },
      fi_types: ["DEPOSIT", "TERM_DEPOSIT", "MUTUAL_FUNDS", "INSURANCE"],
    });
    return { consent_id: String(body.consent_id ?? ""), redirect_url: String(body.redirect_url ?? "") };
  }

  async createFiRequest(consentId: string, material: unknown): Promise<string> {
    const body = await this.post("/fiu/fi/request", { consent_id: consentId, key_material: material });
    return String(body.session_id ?? "");
  }

  async fetchFi(sessionId: string): Promise<{ consentId?: string; FI: { fipId: string; fiType: string; data: unknown }[] }> {
    const body = await this.post("/fiu/fi/fetch", { session_id: sessionId });
    const blocks = Array.isArray(body.FI) ? body.FI as { fipId: string; fiType: string; data: unknown }[] : [];
    return { consentId: typeof body.consentId === "string" ? body.consentId : undefined, FI: blocks };
  }

  private async post(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: {
        authorization: this.clientId
          ? `Basic ${Buffer.from(`${this.clientId}:${this.apiKey}`).toString("base64")}`
          : `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("aa_request_failed");
    return await response.json() as Record<string, unknown>;
  }
}
