"use client";

import { useEffect, useState } from "react";

export function ContactForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.body.dataset.world = "paper";
    return () => {
      delete document.body.dataset.world;
    };
  }, []);

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
          kind: "contact",
          fullName: form.get("fullName"),
          email: form.get("email"),
          message: form.get("message"),
          consent: form.get("consent") === "on",
          sourcePage: "/contact",
          companyWebsite: form.get("companyWebsite"),
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "We couldn’t send that just now. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("We couldn’t send that just now. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="form-ok" role="status">
        <h2>Message received.</h2>
        <p>Thank you. We’ll read it and reply when Monytix is ready to talk.</p>
      </div>
    );
  }

  return (
    <form className="form light-form" onSubmit={onSubmit}>
      <label>
        Full name
        <input name="fullName" autoComplete="name" required />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Message
        <textarea name="message" required />
      </label>
      <label className="check">
        <input name="consent" type="checkbox" required />
        <span>I agree to be contacted about this message.</span>
      </label>
      <label className="hp" aria-hidden="true">
        Company website
        <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn-gold" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
