"use client";

import { useEffect, useState } from "react";
import { OMARK_VIEWBOX, omarkFill, omarkPaths } from "@/lib/omark";
import { site, type Segment } from "@/lib/site";
import { Wordmark } from "./Wordmark";

const segments: Segment[] = ["yellow", "cyan", "orange", "navy"];
const storageKey = "monytix-splash";

export function Splash() {
  const [mode, setMode] = useState<"boot" | "play" | "leave" | "off">("boot");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem(storageKey) === "1";
    if (reduce || seen) {
      setMode("off");
      return;
    }
    setMode("play");
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => finish(), 3800);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
    };
  }, []);

  function finish() {
    sessionStorage.setItem(storageKey, "1");
    setMode("leave");
    window.setTimeout(() => {
      setMode("off");
      document.body.style.overflow = "";
    }, 460);
  }

  if (mode === "off" || mode === "boot") return null;

  return (
    <div className={`splash${mode === "play" ? " is-playing" : ""}${mode === "leave" ? " is-leaving" : ""}`} role="dialog" aria-label="Monytix intro">
      <div className="splash-glow" />
      <button className="splash-skip" type="button" onClick={finish}>
        Skip
      </button>
      <p className="splash-cat">{site.splashCategory}</p>
      <div className="splash-stack">
        <div className="splash-o">
          <div className="splash-ring" />
          <div className="splash-seed" />
          <svg className="splash-segs" viewBox={OMARK_VIEWBOX} aria-hidden="true">
            {segments.map((key) => (
              <path key={key} className={`seg-${key}`} fill={omarkFill[key]} d={omarkPaths[key]} />
            ))}
          </svg>
        </div>
        <div className="splash-rule" />
        <div className="splash-word">
          <Wordmark height={48} />
        </div>
        <p className="splash-tag">{site.splashTagline}</p>
      </div>
    </div>
  );
}
