import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { parseRegistration, rateLimited } from "@/lib/registration";

export const dynamic = "force-dynamic";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

export async function POST(request: Request) {
  if (rateLimited(clientIp(request))) {
    return NextResponse.json({ ok: false, error: "Please wait a moment and try again." }, { status: 429 });
  }

  let body: unknown;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) body = await request.json();
    else {
      const form = await request.formData();
      const entries = Object.fromEntries(form.entries());
      const consent = entries.consent === "on" || entries.consent === "true";
      body = { ...entries, consent };
    }
  } catch {
    return NextResponse.json({ ok: false, error: "That form could not be read." }, { status: 400 });
  }

  const parsed = parseRegistration(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (parsed.value.companyWebsite) return NextResponse.json({ ok: true });

  const pool = getPool();
  if (!pool) {
    return NextResponse.json(
      { ok: false, error: "Registrations are not available just now. Please try again shortly." },
      { status: 503 },
    );
  }

  try {
    await pool.query(
      `INSERT INTO marketing.waitlist_registration
        (kind, interest, full_name, email, country, business_name, message, consent, source_page)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [
        parsed.value.kind,
        parsed.value.interest,
        parsed.value.fullName,
        parsed.value.email,
        parsed.value.country,
        parsed.value.businessName,
        parsed.value.message,
        parsed.value.sourcePage,
      ],
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    console.error("waitlist insert failed", code);
    return NextResponse.json(
      { ok: false, error: "We couldn’t save that just now. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
