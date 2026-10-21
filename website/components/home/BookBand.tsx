"use client";

import Link from "next/link";
import { useState } from "react";
import { weights } from "@/lib/site";
import { OMark } from "../OMark";

export function BookBand({ full = false }: { full?: boolean }) {
  const [active, setActive] = useState(weights[0].name);
  const current = weights.find((item) => item.name === active) ?? weights[0];

  return (
    <section className="band philosophy" id="philosophy">
      <div className="wrap book-grid">
        <div className="cover">
          <OMark size={72} title="Monytix mark" />
          <div>
            <p className="eyebrow">The book</p>
            <h3>Life happens in decisions</h3>
          </div>
          <div className="cover-rule" />
          <p>MagnatePoint</p>
        </div>
        <div>
          <p className="eyebrow">The thinking behind Monytix</p>
          <h2 className="section-title">Life happens in decisions.</h2>
          <p>Every decision carries a weight. Some are visible. Others remain hidden.</p>
          <p>Time. Comfort. Risk. Obligations. Identity. Relationships. Opportunity. Attention. Resilience. Legacy.</p>
          <p>These invisible forces influence the choices we make and the lives we create.</p>
          <p>Life Happens in Decisions explores the deeper meaning behind our everyday choices. Monytix brings this decision-first philosophy into financial life.</p>
          <p>
            <b>The book explores why decisions matter. Monytix helps you navigate them.</b>
          </p>
          <div className="weights">
            {weights.map((item) => (
              <button
                key={item.name}
                className="weight"
                type="button"
                aria-pressed={active === item.name}
                onClick={() => setActive(item.name)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className="weight-line">{current.line}</p>
          {full ? null : (
            <p>
              <Link className="btn-ink" href="/book">
                Discover the Book →
              </Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
