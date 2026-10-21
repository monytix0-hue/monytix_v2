"use client";

import Link from "next/link";
import { useState } from "react";
import type { Interest } from "@/lib/site";

const interests: { id: Interest; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "business", label: "Business" },
  { id: "both", label: "Both" },
];

export function WaitlistForm({
  source,
  tone = "dark",
  idPrefix = "wait",
}: {
  source: string;
  tone?: "dark" | "light";
  idPrefix?: string;
}) {
  const [interest, setInterest] = useState<Interest | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const showBusiness = interest === "business" || interest === "both";
  const invalid = error ? true : undefined;
  const errorId = error ? `${idPrefix}-error` : undefined;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "waitlist",
          interest,
          fullName: form.get("fullName"),
          email: form.get("email"),
          country: form.get("country"),
          businessName: form.get("businessName"),
          consent: form.get("consent") === "on",
          sourcePage: source,
          companyWebsite: form.get("companyWebsite"),
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "We couldn’t save that just now. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("We couldn’t save that just now. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="form-ok" role="status">
        <h3>You’re on the list.</h3>
        <p>We’ll let you know when your Monytix experience is ready.</p>
      </div>
    );
  }

  return (
    <form className={`form${tone === "light" ? " light-form" : ""}`} onSubmit={onSubmit} noValidate>
      <fieldset aria-invalid={invalid} aria-describedby={errorId}>
        <legend>
          I am interested in <span className="hint">(required)</span>
        </legend>
        <div className="pills">
          {interests.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={interest === item.id}
              onClick={() => setInterest(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>
          Full name <span className="hint">(required)</span>
        </span>
        <input
          id={`${idPrefix}-name`}
          name="fullName"
          autoComplete="name"
          required
          aria-invalid={invalid}
          aria-describedby={errorId}
        />
      </label>
      <label>
        <span>
          Email <span className="hint">(required)</span>
        </span>
        <input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={invalid}
          aria-describedby={errorId}
        />
      </label>
      <label>
        <span>
          Country <span className="hint">(optional)</span>
        </span>
        <input name="country" autoComplete="country-name" aria-invalid={invalid} aria-describedby={errorId} />
      </label>
      {showBusiness ? (
        <label>
          <span>
            Business name <span className="hint">(optional)</span>
          </span>
          <input name="businessName" autoComplete="organization" aria-invalid={invalid} aria-describedby={errorId} />
        </label>
      ) : null}
      <label className="check">
        <input name="consent" type="checkbox" required aria-invalid={invalid} aria-describedby={errorId} />
        <span>
          I agree to receive product updates about Monytix. <Link href="/privacy">Privacy Policy</Link>
        </span>
      </label>
      <label className="hp" aria-hidden="true">
        Company website
        <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
      </label>
      {error ? (
        <p className="form-error" id={`${idPrefix}-error`} role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn-gold" type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join Waitlist"}
      </button>
    </form>
  );
}
