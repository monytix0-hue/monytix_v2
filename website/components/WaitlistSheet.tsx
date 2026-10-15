"use client";

import { useEffect, useRef } from "react";
import { useWaitlist } from "./Providers";
import { WaitlistForm } from "./WaitlistForm";

export function WaitlistSheet() {
  const { open, source, closeWaitlist } = useWaitlist();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeWaitlist();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeWaitlist]);

  if (!open) return null;

  return (
    <div className="sheet-back" onMouseDown={closeWaitlist}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <p className="eyebrow">Waitlist</p>
            <h2 id="waitlist-title">Your next decision starts here.</h2>
            <p>Be among the first to experience financial intelligence built around your decisions.</p>
          </div>
          <button ref={closeRef} className="icon-btn" type="button" onClick={closeWaitlist} aria-label="Close">
            ×
          </button>
        </div>
        <WaitlistForm source={source} idPrefix="sheet" />
      </div>
    </div>
  );
}
