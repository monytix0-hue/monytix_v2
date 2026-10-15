"use client";

import { useEffect, useState } from "react";
import { intelligence } from "@/lib/site";

export function Intelligence() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % intelligence.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="band chain" id="intelligence">
      <div className="wrap">
        <p className="eyebrow">Intelligence</p>
        <h2 className="section-title">Financial intelligence that moves with you.</h2>
        <p className="lede">Not just what happened. What matters next.</p>
        <p>
          Your financial circumstances change. Your priorities evolve. Your decisions should reflect both. Monytix brings
          financial information, changing circumstances and meaningful insights together.
        </p>
        <div className="chain-track">
          <span className="chain-bead" style={{ left: `${8 + index * 21}%` }} />
          {intelligence.map((item, itemIndex) => (
            <button
              key={item.name}
              className="step"
              type="button"
              aria-pressed={index === itemIndex}
              onClick={() => setIndex(itemIndex)}
            >
              <i />
              <strong>{item.name}</strong>
              <span>{item.line}</span>
            </button>
          ))}
        </div>
        <p>Because financial intelligence should do more than show you numbers. It should help you move forward.</p>
      </div>
    </section>
  );
}
