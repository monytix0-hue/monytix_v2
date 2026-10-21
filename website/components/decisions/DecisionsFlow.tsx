"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { StageId, World } from "@/lib/site";

type Step = "home" | "weigh" | "mark" | "next";
type OptionId = "a" | "b" | "c";
type Mark = "confirmed" | "later";

const options: {
  id: OptionId;
  badge: string;
  approach: string;
  title: string;
  markTitle: string;
  keep: number;
  protect: number;
  protectColor: string;
  flexible: string;
  days: string;
  accent: string;
}[] = [
  {
    id: "a",
    badge: "OPTION A",
    approach: "Balanced",
    title: "Move ₹4,000",
    markTitle: "Move ₹4,000 to Emergency Buffer",
    keep: 78,
    protect: 58,
    protectColor: "#b65e52",
    flexible: "₹37,400 remains flexible",
    days: "46 safety days",
    accent: "#b65e52",
  },
  {
    id: "b",
    badge: "OPTION B",
    approach: "Safety first",
    title: "Move ₹8,500",
    markTitle: "Move ₹8,500 to Emergency Buffer",
    keep: 60,
    protect: 82,
    protectColor: "#208b79",
    flexible: "₹32,900 remains flexible",
    days: "61 safety days",
    accent: "#208b79",
  },
  {
    id: "c",
    badge: "OPTION C",
    approach: "Flexibility first",
    title: "Do nothing",
    markTitle: "Do nothing",
    keep: 100,
    protect: 30,
    protectColor: "#8261b3",
    flexible: "₹41,400 remains flexible",
    days: "24 safety days",
    accent: "#8261b3",
  },
];

const weights = [
  { name: "Resilience", level: "HIGH", line: "Protection from surprises", width: 86, color: "#208b79", badge: "#bce9db", icon: "/decisions/w-resilience.svg" },
  { name: "Risk", level: "HIGH", line: "Reduce exposure to an emergency", width: 82, color: "#b65e52", badge: "#ffd4ca", icon: "/decisions/w-risk.svg" },
  { name: "Comfort", level: "MEDIUM", line: "Keep enough money usable today", width: 55, color: "#bb785a", badge: "#ffd4ca", icon: "/decisions/w-comfort.svg" },
  { name: "Opportunity", level: "MEDIUM", line: "Keep room for other possibilities", width: 50, color: "#8261b3", badge: "#ded3fa", icon: "/decisions/w-opportunity.svg" },
];

const fits = [
  { name: "Resilience", priority: "High priority", fit: "Strong fit", width: 84, color: "#208b79" },
  { name: "Risk", priority: "High priority", fit: "Strong fit", width: 80, color: "#208b79" },
  { name: "Comfort", priority: "Medium priority", fit: "Good fit", width: 68, color: "#b65e52" },
  { name: "Opportunity", priority: "Medium priority", fit: "Good fit", width: 72, color: "#b65e52" },
];

const others = [
  { icon: "/decisions/shield.svg", dark: "/decisions/shield-dark.svg", wash: "#fff0d9", darkWash: "#233349", tag: "12 days left", title: "Insurance renewal", line: "Current plan · Enhanced plan · Review later" },
  { icon: "/decisions/repeat.svg", dark: "/decisions/repeat-dark.svg", wash: "#ede6fa", darkWash: "#2c2943", tag: "₹2,800/month", title: "Recurring subscriptions", line: "Keep all · Cancel selected · Review later" },
  { icon: "/decisions/growth.svg", dark: "/decisions/growth-dark.svg", wash: "#e2f3ec", darkWash: "#173a3c", tag: "₹18,000 available", title: "Monthly surplus", line: "Build reserve · Invest · Keep flexible" },
];

export function DecisionsFlow({
  world,
  reduce,
  onOpen,
}: {
  world: World;
  reduce: boolean | null;
  onOpen: (step: StageId) => void;
}) {
  const dark = world === "personal" || world === "business";
  const [step, setStep] = useState<Step>("home");
  const [choice, setChoice] = useState<OptionId>("a");
  const [mark, setMark] = useState<Mark>("confirmed");
  const [reason, setReason] = useState("");
  const selected = options.find((item) => item.id === choice) ?? options[0];

  const go = (next: Step) => setStep(next);

  return (
    <div className={`dflow${dark ? " is-dark" : ""}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.28 }}
        >
          {step === "home" ? <Home dark={dark} onWeigh={() => go("weigh")} onOpen={onOpen} /> : null}
          {step === "weigh" ? (
            <Weigh choice={choice} selected={selected} onBack={() => go("home")} onChoose={setChoice} onContinue={() => go("mark")} />
          ) : null}
          {step === "mark" ? (
            <MarkScreen
              selected={selected}
              reason={reason}
              onReason={setReason}
              onBack={() => go("weigh")}
              onConfirm={() => {
                setMark("confirmed");
                go("next");
              }}
              onLater={() => {
                setMark("later");
                go("next");
              }}
            />
          ) : null}
          {step === "next" ? <NextScreen selected={selected} mark={mark} onBack={() => go("mark")} /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Home({ dark, onWeigh, onOpen }: { dark: boolean; onWeigh: () => void; onOpen: (step: StageId) => void }) {
  return (
    <div className="df-stack">
      <div className="df-mark" aria-hidden="true">
        <img src={dark ? "/decisions/wordmark-dark.png" : "/decisions/wordmark-light.png"} alt="" />
      </div>
      <div>
        <h3 className="df-display">Decisions</h3>
        <p className="df-sub">See the choices that deserve your attention</p>
      </div>
      <div className="df-pills" role="tablist" aria-label="Decision states">
        <button type="button" role="tab" aria-selected="true">Need you</button>
        <button type="button" role="tab" aria-selected="false">Upcoming</button>
        <button type="button" role="tab" aria-selected="false">Made</button>
      </div>
      <article className="df-card df-hero">
        <div className="df-badges">
          <span className="df-badge df-badge-rose">NEEDS A CHOICE</span>
          <span className="df-badge df-badge-lilac">3 WEIGHTS</span>
        </div>
        <div className="df-scale" aria-hidden="true">
          <img className="df-halo" src={dark ? "/decisions/halo-dark.svg" : "/decisions/halo.svg"} alt="" />
          <div className="df-rock">
            <span className="df-stem" />
            <span className="df-beam" />
            <img className="df-pans" src={dark ? "/decisions/pans-dark.svg" : "/decisions/pans.svg"} alt="" />
            <img className="df-pivot" src={dark ? "/decisions/pivot-dark.svg" : "/decisions/pivot.svg"} alt="" />
          </div>
          <span className="df-base" />
        </div>
        <p className="df-question">How much should you move to your Emergency Buffer?</p>
        <p className="df-body">Your buffer has reduced while flexible cash is available.</p>
        <div className="df-chips">
          <span>₹4,000</span>
          <span>₹8,500</span>
          <span>Do nothing</span>
        </div>
        <button className="df-gold" type="button" onClick={onWeigh}>
          Weigh your options →
        </button>
      </article>
      <article className="df-card">
        <p className="df-strong">A Decision is a choice — not a recommendation.</p>
        <p className="df-body">Monytix shows the trade-offs. You decide which weights matter most, choose an option, and mark the decision.</p>
      </article>
      <div className="df-stack">
        <h4 className="df-h">Other choices ahead</h4>
        {others.map((item) => (
          <article className="df-choice" key={item.title}>
            <div className="df-choice-top">
              <span className="df-icon" style={{ background: dark ? item.darkWash : item.wash }}>
                <img src={dark ? item.dark : item.icon} alt="" />
              </span>
              <span className="df-tag">{item.tag}</span>
            </div>
            <p className="df-h">{item.title}</p>
            <p className="df-body">{item.line}</p>
            <button className="df-quiet" type="button">Compare choices →</button>
          </article>
        ))}
      </div>
      <nav className="df-nav" aria-label="Product experiences">
        <button type="button" onClick={() => onOpen("live")}>
          <img src={dark ? "/decisions/nav-live-dark.svg" : "/decisions/nav-live.svg"} alt="" />
          Live
        </button>
        <button type="button" className="is-on" aria-current="page">
          <img src={dark ? "/decisions/nav-decisions-dark.svg" : "/decisions/nav-decisions.svg"} alt="" />
          Decisions
        </button>
        <button type="button" onClick={() => onOpen("missions")}>
          <img src={dark ? "/decisions/nav-missions-dark.svg" : "/decisions/nav-missions.svg"} alt="" />
          Missions
        </button>
        <button type="button" onClick={() => onOpen("mile")}>
          <img src={dark ? "/decisions/nav-mile-dark.svg" : "/decisions/nav-mile.svg"} alt="" />
          M.I.L.E.
        </button>
      </nav>
    </div>
  );
}

function Weigh({
  choice,
  selected,
  onBack,
  onChoose,
  onContinue,
}: {
  choice: OptionId;
  selected: (typeof options)[number];
  onBack: () => void;
  onChoose: (id: OptionId) => void;
  onContinue: () => void;
}) {
  return (
    <div className="df-stack">
      <Header title="Weigh your options" kicker="Emergency Buffer" onBack={onBack} />
      <article className="df-card">
        <p className="df-question">How much should you move to your Emergency Buffer?</p>
        <p className="df-body">You have ₹41,400 flexible. Your current buffer is below your preferred level.</p>
      </article>
      <article className="df-card df-soft">
        <p className="df-kicker">THE TRADE-OFF</p>
        <p className="df-h">What are you balancing?</p>
        <p className="df-body">Every option moves the balance between money you can use now and protection you build for later.</p>
        <img className="df-balance" src="/decisions/balance.svg" alt="" />
        <div className="df-ends">
          <span className="df-teal">FLEXIBILITY NOW</span>
          <span className="df-rose">SAFETY LATER</span>
        </div>
      </article>
      <h4 className="df-h">1. See what each choice changes</h4>
      <p className="df-body">Read the shape first. The bars show what you keep today versus what you gain in protection.</p>
      <div className="df-pair" role="radiogroup" aria-label="Choices">
        {options.slice(0, 2).map((item) => (
          <OptionCard key={item.id} item={item} pressed={choice === item.id} onChoose={onChoose} />
        ))}
      </div>
      <OptionCard item={options[2]} pressed={choice === "c"} onChoose={onChoose} wide />
      <h4 className="df-h">2. Tell Monytix what matters to you</h4>
      <p className="df-body">Monytix identifies the relevant Weights. You set their importance. There is no right answer — this is your trade-off.</p>
      <div className="df-pair">
        {weights.map((item) => (
          <article className="df-card df-weight" key={item.name}>
            <div className="df-weight-name">
              <span className="df-icon df-icon-soft"><img src={item.icon} alt="" /></span>
              <strong>{item.name}</strong>
            </div>
            <span className="df-badge" style={{ background: item.badge }}>{item.level}</span>
            <p className="df-body">{item.line}</p>
            <p className="df-meter-label">Your importance</p>
            <span className="df-meter"><i style={{ width: `${item.width}%`, background: item.color }} /></span>
          </article>
        ))}
      </div>
      <h4 className="df-h">3. See your selected choice take shape</h4>
      <article className="df-card df-selected" style={{ borderColor: selected.accent }}>
        <div className="df-split">
          <span className="df-badge df-badge-rose">SELECTED · OPTION {selected.id.toUpperCase()}</span>
          <strong>{selected.title}</strong>
        </div>
        {selected.id === "a" ? (
          <p className="df-body">This choice protects what you rated highly without giving up too much of what you still want to keep.</p>
        ) : (
          <p className="df-body">{selected.flexible}. {selected.days}.</p>
        )}
      </article>
      {selected.id === "a" ? (
        <>
          <article className="df-card">
            <p className="df-kicker df-lilac">YOUR PRIORITIES × THIS CHOICE</p>
            <div className="df-pair">
              {fits.map((item) => (
                <div className="df-fit" key={item.name}>
                  <strong>{item.name}</strong>
                  <span>{item.priority}</span>
                  <span>{item.fit}</span>
                  <span className="df-meter"><i style={{ width: `${item.width}%`, background: item.color }} /></span>
                </div>
              ))}
            </div>
          </article>
          <article className="df-card">
            <p className="df-h">Why the others fall away</p>
            <p className="df-fall"><span className="df-badge df-badge-mint">B</span> More safety, but sacrifices more Comfort than you asked for.</p>
            <p className="df-fall"><span className="df-badge df-badge-lilac">C</span> More flexibility, but misses the Resilience and Risk you rated High.</p>
          </article>
        </>
      ) : null}
      <article className="df-card df-soft">
        <p className="df-quote">“The question isn’t which option is right. It’s which trade-off you’re willing to carry.”</p>
        <p className="df-body">Monytix reflects your priorities. You make the decision.</p>
      </article>
      <button className="df-gold" type="button" onClick={onContinue}>
        Continue with Option {selected.id.toUpperCase()} →
      </button>
    </div>
  );
}

function OptionCard({
  item,
  pressed,
  onChoose,
  wide,
}: {
  item: (typeof options)[number];
  pressed: boolean;
  onChoose: (id: OptionId) => void;
  wide?: boolean;
}) {
  return (
    <button
      className={`df-option${pressed ? " is-on" : ""}${wide ? " is-wide" : ""}`}
      type="button"
      role="radio"
      aria-checked={pressed}
      style={{ borderColor: pressed ? item.accent : undefined }}
      onClick={() => onChoose(item.id)}
    >
      <span className="df-split">
        <span className="df-badge" style={{ background: item.id === "b" ? "#bce9db" : item.id === "c" ? "#ded3fa" : "#ffd4ca" }}>{item.badge}</span>
        <span style={{ color: item.accent }}>{item.approach}</span>
      </span>
      <span className="df-split">
        <strong>{item.title}</strong>
        <span className={`df-radio${pressed ? " is-on" : ""}`} style={{ background: pressed ? item.accent : undefined, borderColor: pressed ? item.accent : undefined }}>
          {pressed ? <img src="/decisions/check.svg" alt="" /> : null}
        </span>
      </span>
      <span className="df-meter-label">Money you keep available</span>
      <span className="df-meter"><i style={{ width: `${item.keep}%`, background: "#208b79" }} /></span>
      <span className="df-meter-label">Emergency protection</span>
      <span className="df-meter"><i style={{ width: `${item.protect}%`, background: item.protectColor }} /></span>
      <span className="df-split df-outcomes">
        <span>{item.flexible}</span>
        <b style={{ color: item.accent }}>{item.days}</b>
      </span>
      <span className="df-hint" style={{ color: item.accent }}>Tap to select and see how it fits what matters to you →</span>
    </button>
  );
}

function MarkScreen({
  selected,
  reason,
  onReason,
  onBack,
  onConfirm,
  onLater,
}: {
  selected: (typeof options)[number];
  reason: string;
  onReason: (value: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  onLater: () => void;
}) {
  return (
    <div className="df-stack">
      <Header title="Mark your decision" kicker="Confirm the choice you want to carry forward" onBack={onBack} />
      <article className="df-card df-selected" style={{ borderColor: selected.accent }}>
        <div className="df-split">
          <img src="/decisions/choice-shield.svg" alt="" width={44} height={44} />
          <span className="df-badge df-badge-rose">YOUR CHOICE</span>
        </div>
        <p className="df-question">{selected.markTitle}</p>
        {selected.id === "a" ? (
          <p className="df-body">₹41,400 flexible → ₹37,400 flexible</p>
        ) : (
          <p className="df-body">{selected.flexible}</p>
        )}
      </article>
      <article className="df-card df-soft">
        <p className="df-with-icon"><img src="/decisions/scale.svg" alt="" /> What you weighted most</p>
        <p className="df-body"><b className="df-teal">Resilience</b> and <b className="df-rose">Risk</b> mattered more to you than preserving all of today’s Comfort.</p>
      </article>
      <article className="df-card">
        <p className="df-h">What this choice is expected to change</p>
        {selected.id === "a" ? (
          <>
            <p className="df-with-icon"><img src="/decisions/change-chart.svg" alt="" /> <span className="df-teal">Emergency Buffer: ₹82K → ₹86K</span></p>
            <hr />
            <p className="df-with-icon"><img src="/decisions/change-shield.svg" alt="" /> <span className="df-lilac">Estimated safety: 38 → 46 days</span></p>
            <p className="df-body">Flexible cash after move: ₹37,400</p>
          </>
        ) : (
          <>
            <p className="df-body">{selected.flexible}</p>
            <p className="df-with-icon"><b style={{ color: selected.accent }}>{selected.days}</b></p>
          </>
        )}
      </article>
      <article className="df-card">
        <label className="df-h" htmlFor="df-reason">Add your reason · optional</label>
        <textarea id="df-reason" value={reason} placeholder="I chose this because…" onChange={(event) => onReason(event.target.value)} />
      </article>
      <h4 className="df-h">What would you like to do?</h4>
      <article className="df-card df-warm">
        <p className="df-h">Confirm this decision</p>
        <p className="df-body">Mark this as your chosen decision. Monytix can then show the natural next-step solutions and track the outcome in M.I.L.E.</p>
        <button className="df-gold" type="button" onClick={onConfirm}>Confirm decision →</button>
      </article>
      <article className="df-card">
        <p className="df-h">Mark it for later</p>
        <p className="df-body">Keep this choice saved without finalising it. Monytix will return it to Decisions when it becomes relevant again.</p>
        <button className="df-quiet" type="button" onClick={onLater}>Save for later</button>
      </article>
    </div>
  );
}

function NextScreen({ selected, mark, onBack }: { selected: (typeof options)[number]; mark: Mark; onBack: () => void }) {
  return (
    <div className="df-stack">
      <Header title="Next step" kicker="Your decision created a financial need" onBack={onBack} />
      <article className="df-card df-selected" style={{ borderColor: selected.accent }}>
        <div className="df-split">
          <img src="/decisions/marked-shield.svg" alt="" width={44} height={44} />
          <span className={`df-badge ${mark === "confirmed" ? "df-badge-mint" : "df-badge-lilac"}`}>
            {mark === "confirmed" ? "DECISION MARKED" : "SAVED FOR LATER"}
          </span>
        </div>
        <p className="df-question">{selected.markTitle}</p>
        <p className="df-lilac">Decision → Need → Solution options</p>
      </article>
      <article className="df-card df-soft">
        <p className="df-with-icon"><img src="/decisions/shield-check.svg" alt="" /> Need: keep emergency money safe and accessible</p>
        <p className="df-body">Your choice suggests a place for emergency money that prioritizes access and capital stability. Products appear only after the need is established.</p>
      </article>
      <h4 className="df-h">Ways to fulfil this decision</h4>
      <article className="df-card">
        <div className="df-solution">
          <span className="df-icon" style={{ background: "#e2f3ec" }}><img src="/decisions/wallet.svg" alt="" /></span>
          <div>
            <p className="df-h">Keep in savings</p>
            <span className="df-badge df-badge-mint">Highest access</span>
          </div>
        </div>
        <p className="df-body">Use your existing savings account</p>
        <button className="df-quiet" type="button">No new product needed →</button>
      </article>
      <article className="df-card">
        <div className="df-solution">
          <span className="df-icon" style={{ background: "#fff0e3" }}><img src="/decisions/swap.svg" alt="" /></span>
          <div>
            <p className="df-h">Sweep / short deposit</p>
            <span className="df-badge df-badge-rose">Access + some return</span>
          </div>
        </div>
        <p className="df-body">Automatically moves excess balance while retaining liquidity</p>
        <button className="df-quiet" type="button">Explore deposits →</button>
      </article>
      <article className="df-card">
        <div className="df-solution">
          <span className="df-icon" style={{ background: "#ede6fa" }}><img src="/decisions/chart.svg" alt="" /></span>
          <div>
            <p className="df-h">Liquid investment option</p>
            <span className="df-badge df-badge-lilac">Potentially higher return</span>
          </div>
        </div>
        <p className="df-body">May involve market/product risk and redemption considerations</p>
        <button className="df-quiet" type="button">Explore investments →</button>
      </article>
      <article className="df-card">
        <p className="df-with-icon"><img src="/decisions/info.svg" alt="" /> Why you are seeing these</p>
        <p className="df-body">These options follow from the decision you already made. Monytix does not create a Decision because a product is available.</p>
      </article>
      <article className="df-card df-mint">
        <p className="df-h">Not ready to choose a financial product?</p>
        <p className="df-body">Your Decision is still complete. You can return to solution options later.</p>
      </article>
    </div>
  );
}

function Header({ title, kicker, onBack }: { title: string; kicker: string; onBack: () => void }) {
  return (
    <div className="df-head">
      <button className="df-back" type="button" onClick={onBack} aria-label="Back">‹</button>
      <div>
        <h3 className="df-display">{title}</h3>
        <p className="df-kicker df-teal">{kicker}</p>
      </div>
    </div>
  );
}
