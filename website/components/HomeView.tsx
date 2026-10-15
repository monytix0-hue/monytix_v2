"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fragments, thread, type Segment } from "@/lib/site";
import { OMark } from "./OMark";
import { IphoneFrame } from "./IphoneFrame";
import { ExperienceScreen } from "./screens/AppScreens";
import { Reveal } from "./Reveal";
import { Splash } from "./Splash";
import { useWaitlist } from "./Providers";
import { WaitlistForm } from "./WaitlistForm";
import { BookBand } from "./home/BookBand";
import { Intelligence } from "./home/Intelligence";
import { ProductStage } from "./home/ProductStage";
import { Questions } from "./home/Questions";

export function HomeView() {
  return (
    <>
      <Splash />
      <DecisionThread />
      <Hero />
      <Life />
      <Worlds />
      <ProductStage />
      <Questions />
      <Intelligence />
      <BookBand />
      <FinalCta />
    </>
  );
}

function DecisionThread() {
  const [current, setCurrent] = useState("hero");

  useEffect(() => {
    const nodes = thread
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => node !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setCurrent(visible.target.id);
      },
      { rootMargin: "-40% 0px -45% 0px", threshold: [0.15, 0.4] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="thread" aria-label="On this page">
      {thread.map((item) => (
        <a key={item.id} href={`#${item.id}`} className={current === item.id ? "is-on" : ""}>
          <span />
          <b>{item.label}</b>
        </a>
      ))}
    </nav>
  );
}

function Hero() {
  const { openWaitlist } = useWaitlist();
  const [hover, setHover] = useState<Segment | null>(null);
  const [locked, setLocked] = useState<Segment | null>(null);
  const active = hover ?? locked;

  return (
    <section className="hero" id="hero">
      <div className="hero-glow" data-tint={active ?? ""} />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">Your Financial Decision OS</p>
          <h1 className="display">Life happens in decisions.</h1>
          <p className="lede">Every decision shapes what comes next.</p>
          <p>Some decisions are small. Others change everything. Every day, we make choices that shape our financial lives. But knowing what to do isn’t always easy.</p>
          <p>Meet Monytix. Helping individuals and businesses understand their finances, navigate choices and move forward with confidence.</p>
          <div className="hero-actions">
            <a className="btn-gold" href="#explore">
              Explore Monytix
            </a>
            <button className="btn-ghost" type="button" onClick={() => openWaitlist("hero")}>
              Join Waitlist
            </button>
          </div>
          <p className="hero-close">Understand more. Decide better. Move forward.</p>
        </div>
        <div className="field">
          <div className="field-mark">
            <OMark size={340} active={active} />
          </div>
          <div className="chips">
            {fragments.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip chip-${item.id}${active === item.id ? " is-on" : ""}`}
                aria-pressed={active === item.id}
                onMouseEnter={() => setHover(item.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(item.id)}
                onBlur={() => setHover(null)}
                onClick={() => setLocked((value) => (value === item.id ? null : item.id))}
              >
                <i />
                {item.phrase}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Life() {
  return (
    <section className="band band-life" id="life">
      <Reveal className="wrap life-grid">
        <div>
          <p className="eyebrow">Life and decisions</p>
          <h2 className="section-title">Behind every decision, there’s more than money.</h2>
        </div>
        <div>
          <p>Life doesn’t come with a financial instruction manual. We earn. We spend. We save. We build.</p>
          <p>Sometimes we’re certain. Sometimes we hesitate. And sometimes, the decisions that matter most are the hardest to make.</p>
          <p>Because financial decisions aren’t just about numbers. They’re about responsibilities, opportunities, ambitions and the future we’re trying to create.</p>
          <p>What if understanding your finances could make those decisions easier? That’s where Monytix begins.</p>
        </div>
      </Reveal>
    </section>
  );
}

function Worlds() {
  return (
    <section className="band worlds" id="worlds">
      <div className="wrap">
        <p className="eyebrow">Personal and business</p>
        <h2 className="section-title">Two worlds. One purpose.</h2>
        <div className="world-grid">
          <Link className="world-side world-personal" href="/personal">
            <span className="world-kicker">
              <i aria-hidden="true" />
              Personal
            </span>
            <h3>Your life. Your money. Your decisions.</h3>
            <p>From everyday spending to life’s biggest milestones, every financial choice matters. Monytix helps you understand where you stand, recognise what matters and make choices that support the life you want.</p>
            <p>Because financial confidence begins with clarity.</p>
            <IphoneFrame size="compact">
              <ExperienceScreen world="personal" stage="live" compact />
            </IphoneFrame>
            <b>Explore Personal →</b>
          </Link>
          <p className="world-purpose">Wherever decisions happen, Monytix belongs.</p>
          <Link className="world-side world-business" href="/business">
            <span className="world-kicker">
              <i aria-hidden="true" />
              Business
            </span>
            <h3>Your business. Your decisions. Your future.</h3>
            <p>Every business is built on decisions. What to spend. When to invest. Where to grow. What to protect. Monytix helps you understand your business finances, recognise opportunities and navigate the decisions that shape your business.</p>
            <p>Because every business deserves the confidence to move forward.</p>
            <IphoneFrame size="compact">
              <ExperienceScreen world="business" stage="live" compact />
            </IphoneFrame>
            <b>Explore Business →</b>
          </Link>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final" id="waitlist">
      <div className="wrap final-grid">
        <div>
          <p className="eyebrow">Begin</p>
          <h2 className="section-title">Your next decision starts here.</h2>
          <p className="lede">Life will keep presenting choices. You don’t have to face them without clarity.</p>
          <p>Whether you’re managing your personal finances or building a business, Monytix helps you understand what matters and move forward.</p>
          <p>Make every decision count. Be among the first to experience Monytix.</p>
        </div>
        <WaitlistForm source="/#waitlist" idPrefix="home" />
      </div>
    </section>
  );
}
