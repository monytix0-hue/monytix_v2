"use client";

import { useEffect } from "react";
import type { World } from "@/lib/site";
import { useWaitlist } from "./Providers";
import { WaitlistForm } from "./WaitlistForm";
import { ProductStage } from "./home/ProductStage";
import { Questions } from "./home/Questions";

const copy = {
  personal: {
    kicker: "Personal",
    title: "Your life. Your money. Your decisions.",
    body: "From everyday spending to life’s biggest milestones, every financial choice matters. Monytix helps you understand where you stand, recognise what matters and make choices that support the life you want.",
    close: "Because financial confidence begins with clarity.",
  },
  business: {
    kicker: "Business",
    title: "Your business. Your decisions. Your future.",
    body: "Every business is built on decisions. What to spend. When to invest. Where to grow. What to protect. Monytix helps you understand your business finances, recognise opportunities and navigate the decisions that shape your business.",
    close: "Because every business deserves the confidence to move forward.",
  },
} as const;

export function WorldView({ world }: { world: World }) {
  const { openWaitlist } = useWaitlist();
  const text = copy[world];

  useEffect(() => {
    document.body.dataset.world = world;
    return () => {
      delete document.body.dataset.world;
    };
  }, [world]);

  return (
    <div className="world-page">
      <section className="page-hero">
        <div className="wrap">
          <p className="eyebrow">{text.kicker}</p>
          <h1 className="display">{text.title}</h1>
          <p className="lede" style={{ color: "inherit", maxWidth: "40rem" }}>
            {text.body}
          </p>
          <p>{text.close}</p>
          <div className="hero-actions">
            <a className="btn-gold" href="#explore" style={{ color: "#12181f" }}>
              Explore {text.kicker}
            </a>
            <button className="btn-ink" type="button" onClick={() => openWaitlist(world)}>
              Join Waitlist
            </button>
          </div>
        </div>
      </section>
      <ProductStage locked={world} intro={false} />
      <Questions world={world} />
      <section className="final" id="waitlist">
        <div className="wrap final-grid">
          <div>
            <h2 className="section-title">Your next decision starts here.</h2>
            <p>Be among the first to experience financial intelligence built around your decisions.</p>
          </div>
          <WaitlistForm source={`/${world}`} idPrefix={world} />
        </div>
      </section>
    </div>
  );
}
