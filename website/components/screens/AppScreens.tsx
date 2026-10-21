"use client";

import { useState } from "react";
import type { StageId, World } from "@/lib/site";
import type { ScreenId } from "../Widgets";

type LiveView = "home" | "changed" | "ahead" | "pulse" | "transactions";

const nav: { id: StageId; label: string; icon: string }[] = [
  { id: "live", label: "Live", icon: "/screens/nav-live.svg" },
  { id: "decisions", label: "Decisions", icon: "/screens/nav-decisions.svg" },
  { id: "missions", label: "Missions", icon: "/screens/nav-missions.svg" },
  { id: "mile", label: "M.I.L.E.", icon: "/screens/nav-mile.svg" },
];

export function stageForScreen(screen: ScreenId): StageId {
  if (screen === "decision" || screen === "bdecisions" || screen === "breserve") return "decisions";
  if (screen === "mission" || screen === "goal" || screen === "bmission") return "missions";
  if (screen === "mile" || screen === "bmile") return "mile";
  return "live";
}

export function ExperienceScreen({
  world,
  stage,
  compact = false,
  onOpen,
}: {
  world: World;
  stage: StageId;
  compact?: boolean;
  onOpen?: (stage: StageId) => void;
}) {
  return (
    <div className={`app-frame${world === "business" ? " is-biz" : ""}${compact ? " is-fit" : ""}`}>
      {world === "personal" && stage === "live" ? <PersonalLive onOpen={onOpen} /> : null}
      {world === "personal" && stage === "missions" ? <PersonalMissions onOpen={onOpen} /> : null}
      {world === "personal" && stage === "mile" ? <PersonalMile onOpen={onOpen} /> : null}
      {world === "business" && stage === "live" ? <BusinessLive /> : null}
      {world === "business" && stage === "decisions" ? <BusinessDecisions onOpen={onOpen} /> : null}
      {world === "business" && stage === "missions" ? <BusinessMissions onOpen={onOpen} /> : null}
      {world === "business" && stage === "mile" ? <BusinessMile onOpen={onOpen} /> : null}
    </div>
  );
}

function Mark() {
  return (
    <span className="as-mark" aria-hidden="true">
      <img src="/screens/wordmark.png" alt="" />
    </span>
  );
}

function Gold({ children, onClick }: { children: string; onClick?: () => void }) {
  return (
    <button className="as-gold" type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function Back({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="as-detail-head">
      <button className="as-back" type="button" onClick={onBack} aria-label="Back">
        ‹
      </button>
      <div>
        <h3>{label}</h3>
      </div>
      <Mark />
    </div>
  );
}

function AppNav({ active, onOpen }: { active: StageId; onOpen?: (stage: StageId) => void }) {
  return (
    <nav className="as-nav" aria-label="Product experiences">
      {nav.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === active ? "is-on" : undefined}
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => onOpen?.(item.id)}
        >
          <img src={item.icon} alt="" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function PersonalLive({ onOpen }: { onOpen?: (stage: StageId) => void }) {
  const [view, setView] = useState<LiveView>("home");
  if (view === "changed") return <AttentionDetail onBack={() => setView("home")} onTransactions={() => setView("transactions")} onOpen={onOpen} />;
  if (view === "ahead") return <CashDetail onBack={() => setView("home")} />;
  if (view === "pulse") return <PulseDetail onBack={() => setView("home")} />;
  if (view === "transactions") return <TransactionsDetail onBack={() => setView("home")} />;
  return (
    <div className="as-stack">
      <header className="as-top">
        <div>
          <p className="as-greet">Good afternoon Sandeep</p>
          <p className="as-muted">Your money, right now</p>
        </div>
        <Mark />
      </header>
      <button className="as-moly" type="button">
        <img src="/screens/sparkles.svg" alt="" />
        MolyBot
      </button>
      <button className="as-link" type="button" onClick={() => setView("transactions")}>
        <img src="/screens/receipt.svg" alt="" />
        Transactions
        <span>3 need context</span>
        <img src="/screens/chevron.svg" alt="" />
      </button>

      <section className="as-card as-goal">
        <p className="as-kicker">MISSIONS · 2 ACTIVE</p>
        <div className="as-ring" aria-hidden="true">
          <img src="/screens/orbit-halo.svg" alt="" />
          <img src="/screens/orbit-track.svg" alt="" />
          <img src="/screens/goal-fill.svg" alt="" />
          <img className="as-origin" src="/screens/progress-origin.svg" alt="" />
          <img className="as-marker" src="/screens/progress-marker.svg" alt="" />
        </div>
        <p className="as-figure">₹82K / ₹1.5L</p>
        <p className="as-muted">55% · On track</p>
        <p className="as-strong">Emergency Buffer</p>
        <div className="as-mini">
          <img src="/screens/orbit-halo-sm.svg" alt="" />
          <div>
            <p className="as-strong">Home Fund</p>
            <p className="as-muted">₹1.84L / ₹5L · 37% · +₹12K this month</p>
          </div>
        </div>
        <Gold onClick={() => onOpen?.("missions")}>View Missions →</Gold>
      </section>

      <section className="as-card">
        <p className="as-kicker as-rose">DECISIONS · 2 NEED YOU</p>
        <article>
          <p className="as-strong">Strengthen your emergency cushion</p>
          <p className="as-muted">Your buffer has reduced.</p>
        </article>
        <article>
          <p className="as-strong">Review recurring spending</p>
          <p className="as-muted">₹2,800/month may be worth reviewing.</p>
        </article>
        <Gold onClick={() => onOpen?.("decisions")}>View Decisions →</Gold>
      </section>

      <section className="as-card">
        <p className="as-kicker">FOR YOU · 2 CHANGES</p>
        <p className="as-strong">Two things are worth a look</p>
        <article className="as-row">
          <img src="/screens/trending-up.svg" alt="" />
          <div>
            <p className="as-strong">Spending pace increased this week</p>
            <p className="as-muted">Lifestyle spending is ₹4,800 above your usual pace.</p>
          </div>
        </article>
        <article className="as-row">
          <img src="/screens/shield-alert.svg" alt="" />
          <div>
            <p className="as-strong">Emergency Buffer is slightly behind</p>
            <p className="as-muted">Progress is ₹6,200 below this month’s expected pace.</p>
          </div>
        </article>
        <Gold onClick={() => setView("changed")}>See what changed →</Gold>
      </section>

      <section className="as-card">
        <p className="as-kicker as-teal">CASH FLOW · 14 DAYS</p>
        <p className="as-figure">₹41,400 flexible</p>
        <div className="as-bar" aria-hidden="true">
          <i />
          <b />
        </div>
        <p className="as-muted">₹72,600 available · ₹31,200 committed</p>
        <span className="as-pill">COMFORTABLE</span>
        <p className="as-muted">Salary expected in 11 days</p>
        <Gold onClick={() => setView("ahead")}>See what’s ahead →</Gold>
      </section>

      <section className="as-card">
        <p className="as-kicker">FINANCIAL PULSE · UPDATED TODAY</p>
        <p className="as-figure">Steady</p>
        <p className="as-muted">Your position remains balanced, but commitments have increased.</p>
        <p className="as-muted">2 improving · 6 stable · 2 watch</p>
        <ul className="as-list">
          <li><img src="/screens/activity.svg" alt="" /> Obligations ↑ <span>Fixed commitments increased</span></li>
          <li><img src="/screens/sprout.svg" alt="" /> Opportunity ↑ <span>Flexible money improved</span></li>
          <li><img src="/screens/shield.svg" alt="" /> Resilience ↓ <span>Your cushion reduced slightly</span></li>
        </ul>
        <Gold onClick={() => setView("pulse")}>Explore your 10 Weights →</Gold>
      </section>

      <section className="as-card">
        <p className="as-kicker as-teal">M.I.L.E.</p>
        <p className="as-muted">Money Impact & Life Evolution</p>
        <p className="as-figure">₹38,400</p>
        <p className="as-muted">positive financial impact</p>
        <p className="as-muted">+₹6,200 this month · Resilience ↑</p>
        <Gold onClick={() => onOpen?.("mile")}>See your M.I.L.E. →</Gold>
      </section>
      <AppNav active="live" onOpen={onOpen} />
    </div>
  );
}

function AttentionDetail({
  onBack,
  onTransactions,
  onOpen,
}: {
  onBack: () => void;
  onTransactions: () => void;
  onOpen?: (stage: StageId) => void;
}) {
  return (
    <div className="as-stack">
      <Back label="What changed" onBack={onBack} />
      <p className="as-muted">The important shifts since your last visit</p>
      <section className="as-card as-wash">
        <span className="as-pill">2 WORTH A LOOK</span>
        <p className="as-strong as-lead">Your money is steady overall.</p>
        <p className="as-muted">Two changes are meaningful enough to understand — one in spending and one in your Emergency Buffer.</p>
      </section>
      <section className="as-card">
        <div className="as-split">
          <p className="as-strong">Spending pace increased</p>
          <span className="as-pill">Comfort ↑</span>
        </div>
        <p className="as-muted">Lifestyle spending is ₹4,800 above your usual weekly pace.</p>
        <Gold onClick={onTransactions}>See the transactions →</Gold>
      </section>
      <section className="as-card as-lilac">
        <div className="as-split">
          <p className="as-strong">Emergency Buffer is behind</p>
          <span className="as-pill as-pill-lilac">Resilience ↓</span>
        </div>
        <p className="as-muted">You are ₹6,200 below this month’s expected Mission pace.</p>
        <Gold onClick={() => onOpen?.("missions")}>Open Emergency Buffer →</Gold>
      </section>
      <section className="as-card">
        <p className="as-kicker as-teal">WHAT DIDN’T CHANGE</p>
        <p>Cash flow remains comfortable for the next 14 days.</p>
        <p>No unusual income or major commitment changes detected.</p>
      </section>
    </div>
  );
}

function CashDetail({ onBack }: { onBack: () => void }) {
  const events = [
    { icon: "/screens/cash-wallet.svg", tone: "mint", when: "Today", title: "Current flexible money", amount: "₹41,400" },
    { icon: "/screens/cash-landmark.svg", tone: "rose", when: "In 3 days", title: "HDFC EMI", amount: "−₹18,400" },
    { icon: "/screens/cash-receipt.svg", tone: "rose", when: "In 6 days", title: "Subscriptions & bills", amount: "−₹4,800" },
    { icon: "/screens/cash-arrow.svg", tone: "mint", when: "In 11 days", title: "Expected salary", amount: "+₹1,42,000" },
    { icon: "/screens/cash-flag.svg", tone: "lilac", when: "Day 14", title: "Projected position", amount: "Comfortable" },
  ];
  return (
    <div className="as-stack">
      <Back label="Cash Flow" onBack={onBack} />
      <p className="as-muted">Know how much room you actually have</p>
      <section className="as-card as-teal-card">
        <p className="as-kicker">NEXT 14 DAYS</p>
        <p className="as-figure">₹41,400</p>
        <p>flexible after known commitments</p>
        <div className="as-bar" aria-hidden="true"><i /><b /></div>
        <div className="as-split">
          <p><b>₹72,600</b><span className="as-muted">Available</span></p>
          <p><b>₹31,200</b><span className="as-muted">Committed</span></p>
        </div>
      </section>
      <h4 className="as-strong">What’s ahead</h4>
      <ol className="as-path">
        {events.map((item) => (
          <li key={item.title} className={`is-${item.tone}`}>
            <img src={item.icon} alt="" />
            <div>
              <span className={`as-pill${item.tone === "rose" ? " as-pill-rose" : item.tone === "lilac" ? " as-pill-lilac" : ""}`}>{item.when}</span>
              <p>{item.title}</p>
              <b>{item.amount}</b>
            </div>
          </li>
        ))}
      </ol>
      <section className="as-card">
        <p className="as-strong"><img src="/screens/cash-check.svg" alt="" /> No cash-flow action needed</p>
        <p className="as-muted">Your known commitments are covered within the current outlook.</p>
      </section>
    </div>
  );
}

const weights = [
  ["Obligations", "Fixed commitments increased"],
  ["Opportunity", "Flexible money improved"],
  ["Resilience", "Your cushion reduced slightly"],
  ["Comfort", "Around your usual level"],
  ["Risk", "No material change"],
  ["Time", "Stable"],
  ["Relationships", "Stable"],
  ["Identity", "Stable"],
  ["Attention", "Stable"],
  ["Legacy", "Stable"],
] as const;

function PulseDetail({ onBack }: { onBack: () => void }) {
  return (
    <div className="as-stack">
      <div className="as-detail-head">
        <button className="as-back" type="button" onClick={onBack} aria-label="Back">‹</button>
        <img className="as-pulse-mark" src="/screens/activity.svg" alt="" />
      </div>
      <h3>Financial Pulse</h3>
      <p className="as-muted">See what is shaping your financial life</p>
      <section className="as-card">
        <p className="as-kicker">UPDATED TODAY</p>
        <p className="as-figure">Steady</p>
        <p className="as-muted">Your overall position is balanced. Rising obligations are being offset by improved opportunity.</p>
        <p className="as-muted">2 improving · 6 stable · 2 watch</p>
      </section>
      <h4 className="as-strong">Your 10 Weights</h4>
      <ul className="as-list">
        {weights.map(([name, line]) => (
          <li key={name}>{name}<span>{line}</span></li>
        ))}
      </ul>
      <p className="as-muted">Why did a Weight move?</p>
    </div>
  );
}

const transactions = [
  { icon: "/screens/utensils.svg", name: "Swiggy", line: "Food & Lifestyle", amount: "₹680", tone: "mint", weight: "Comfort ↑", status: "Understood", card: "teal" },
  { icon: "/screens/tx-bag.svg", name: "Amazon", line: "Lifestyle / Discretionary", amount: "₹1,249", tone: "rose", weight: "Comfort ↑", status: "Needs context", card: "rose" },
  { icon: "/screens/cash-landmark.svg", name: "HDFC EMI", line: "Obligation", amount: "₹18,400", tone: "rose", weight: "Obligations ↑", status: "Understood", card: "lilac" },
  { icon: "/screens/cash-arrow.svg", name: "Salary", line: "Income", amount: "+₹1,42,000", tone: "mint", weight: "Opportunity ↑", status: "Understood", card: "teal" },
  { icon: "/screens/tx-user.svg", name: "UPI · Ravi", line: "Person transfer", amount: "₹2,500", tone: "lilac", weight: "—", status: "Needs context", card: "navy" },
];

function TransactionsDetail({ onBack }: { onBack: () => void }) {
  const [filter, setFilter] = useState("All");
  return (
    <div className="as-stack">
      <Back label="Transactions" onBack={onBack} />
      <p className="as-muted">The evidence behind your financial intelligence</p>
      <section className="as-card as-teal-card">
        <div className="as-split">
          <p className="as-strong">TODAY ₹2,480</p>
          <span className="as-pill as-pill-rose">3 NEED CONTEXT</span>
        </div>
        <p className="as-muted">Correcting context improves your Weights and future Decisions.</p>
      </section>
      <div className="as-filters" role="tablist" aria-label="Transaction filters">
        {["All", "Income", "Spend", "Transfers"].map((item) => (
          <button key={item} type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      {transactions.filter((item) => filter === "All" || (filter === "Income" && item.line === "Income") || (filter === "Spend" && item.line !== "Income" && item.line !== "Obligation" && item.line !== "Person transfer") || (filter === "Transfers" && (item.line === "Obligation" || item.line === "Person transfer"))).map((item) => (
        <article key={item.name} className={`as-card is-${item.card}`}>
          <div className="as-row">
            <img src={item.icon} alt="" />
            <div>
              <p className="as-strong">{item.name}</p>
              <p className="as-muted">{item.line}</p>
            </div>
            <b>{item.amount}</b>
          </div>
          <div className="as-split">
            <span className={item.tone === "mint" ? "as-teal" : item.tone === "rose" ? "as-rose" : "as-lilac-text"}>{item.weight}</span>
            <span className={`as-pill${item.status === "Needs context" ? " as-pill-rose" : ""}`}>{item.status}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function PersonalMissions({ onOpen }: { onOpen?: (stage: StageId) => void }) {
  const [sheet, setSheet] = useState(false);
  return (
    <div className="as-stack">
      <header className="as-top">
        <div>
          <h3>Missions</h3>
          <p className="as-muted">The things you’ve chosen to make happen.</p>
        </div>
        <Mark />
      </header>
      <section className="as-card">
        <p className="as-strong">3 active missions</p>
        <p className="as-muted">₹2,14,000 working toward your goals</p>
        <p className="as-muted">2 moving · 1 needs attention</p>
      </section>
      <button className="as-card as-mission" type="button" onClick={() => setSheet(true)}>
        <img src="/screens/shield-plus.svg" alt="" />
        <div>
          <p className="as-strong">Emergency Buffer</p>
          <p>₹84,000 of ₹1,50,000</p>
          <span className="as-track"><i style={{ width: "56%" }} /></span>
          <p className="as-muted">Resilience · Risk · +128 MILEs</p>
        </div>
      </button>
      <article className="as-card as-mission">
        <img src="/screens/mission-emblem.svg" alt="" />
        <div>
          <p className="as-strong">Home Fund</p>
          <p>₹3.2L of ₹12L</p>
          <span className="as-track is-lilac"><i style={{ width: "27%" }} /></span>
          <p className="as-muted">Legacy · Opportunity · +74 MILEs</p>
        </div>
      </article>
      <article className="as-card as-mission">
        <img src="/screens/utensils.svg" alt="" />
        <div>
          <p className="as-strong">Reduce dining spend</p>
          <p>₹3,100 less this month</p>
          <span className="as-track is-rose"><i style={{ width: "74%" }} /></span>
          <p className="as-muted">Attention · Comfort · +26 MILEs · On track</p>
        </div>
      </article>
      <p className="as-quiet">✓ Completed Missions</p>
      <p className="as-quiet">+ Create a Mission</p>
      {sheet ? (
        <div className="as-sheet" role="dialog" aria-label="Emergency Buffer">
          <button className="as-back" type="button" onClick={() => setSheet(false)} aria-label="Close">‹</button>
          <p className="as-kicker as-teal">RESILIENCE · RISK</p>
          <h3>Emergency Buffer</h3>
          <p className="as-figure">₹84,000</p>
          <p className="as-muted">of ₹1,50,000 · 56% · On track</p>
          <p>+128 MILEs</p>
          <Gold onClick={() => setSheet(false)}>Back to Missions</Gold>
        </div>
      ) : null}
      <AppNav active="missions" onOpen={onOpen} />
    </div>
  );
}

function PersonalMile({ onOpen }: { onOpen?: (stage: StageId) => void }) {
  return (
    <div className="as-stack">
      <header className="as-top">
        <div>
          <h3>M.I.L.E.</h3>
          <p className="as-muted">Money Impact & Life Evolution</p>
        </div>
        <span className="as-pill">LAST 3 MONTHS</span>
      </header>
      <section className="as-card">
        <p className="as-kicker">YOUR RECENT FINANCIAL DISTANCE</p>
        <p className="as-figure">426 <span>MILEs</span></p>
        <p className="as-teal">+126 in September · ↑ moving faster</p>
        <div className="as-bars" aria-hidden="true">
          <span style={{ height: 32 }}>JUL<small>118</small></span>
          <span style={{ height: 50 }}>AUG<small>182</small></span>
          <span className="is-now" style={{ height: 36 }}>SEP<small>126</small></span>
        </div>
        <p className="as-quiet">View lifetime journey</p>
      </section>
      <section className="as-card">
        <p className="as-kicker">POSITIVE FINANCIAL IMPACT</p>
        <p className="as-figure">₹42,600</p>
        <p className="as-muted">attributable in the last 3 months</p>
        <div className="as-tiles">
          <p>₹20K<small>Protected</small></p>
          <p>₹12K<small>Debt</small></p>
          <p>₹6.6K<small>Saved</small></p>
          <p>₹4K<small>Wealth</small></p>
        </div>
        <p className="as-quiet">See where your impact came from →</p>
      </section>
      <section className="as-card">
        <p className="as-kicker">HOW YOUR FINANCIAL LIFE IS MOVING</p>
        <p className="as-strong">Three forces improved this period</p>
        <p className="as-muted">Protection stronger · Possibility opening</p>
        <p className="as-muted">Resilience ↑ · Opportunity ↑ · Obligations ↓</p>
      </section>
      <section className="as-card">
        <p className="as-kicker">RECENT MILEs</p>
        <p className="as-row"><img src="/screens/shield-check.svg" alt="" /><span>Emergency Buffer · ₹10,000 protected <b>+59</b></span></p>
        <p className="as-row"><img src="/screens/credit-card.svg" alt="" /><span>Credit Card Payment · ₹8,000 debt reduced <b>+34</b></span></p>
        <p className="as-row"><img src="/screens/utensils.svg" alt="" /><span>Dining Optimization · ₹2,400 saved <b>+18</b></span></p>
        <p className="as-quiet">See every MILE</p>
      </section>
      <section className="as-card">
        <p className="as-kicker">YOUR 2026 M.I.L.E. REPORT</p>
        <p className="as-strong">See the year your money changed.</p>
        <p className="as-muted">Decisions · Missions · Impact · Evolution</p>
      </section>
      <AppNav active="mile" onOpen={onOpen} />
    </div>
  );
}

function BusinessLive() {
  return (
    <div className="as-stack">
      <section className="as-card">
        <p className="as-kicker">FOR YOU · 2 CHANGES</p>
        <p className="as-strong">Two business shifts are worth a look</p>
        <article className="as-row">
          <img src="/screens/biz-trend.svg" alt="" />
          <div>
            <p className="as-strong">Operating costs increased this week</p>
            <p className="as-muted">Operating spend is ₹48,000 above its recent pace.</p>
          </div>
        </article>
        <article className="as-row">
          <img src="/screens/biz-shield-alert.svg" alt="" />
          <div>
            <p className="as-strong">Reserve coverage is below target</p>
            <p className="as-muted">Current coverage is 53 days against a 90-day target.</p>
          </div>
        </article>
        <p className="as-quiet">See what changed →</p>
      </section>
      <section className="as-card">
        <div className="as-split">
          <p className="as-kicker">BUSINESS PULSE</p>
          <span className="as-pill as-pill-teal">UPDATED TODAY</span>
        </div>
        <img className="as-biz-icon" src="/screens/biz-pulse.svg" alt="" />
        <p className="as-figure">Stable</p>
        <p className="as-muted">Cash stability is holding, while obligations and customer dependency need attention.</p>
        <p className="as-muted">2 improving · 4 stable · 2 watch</p>
        <ul className="as-list">
          <li><img src="/screens/biz-obligation.svg" alt="" /> Obligation Pressure ↑ <span>Supplier and payroll commitments increased</span></li>
          <li><img src="/screens/biz-protection.svg" alt="" /> Protection Adequacy ↑ <span>Reserve coverage improved</span></li>
          <li><img src="/screens/biz-dependency.svg" alt="" /> Dependency Pressure ↑ <span>Top customer concentration remains high</span></li>
        </ul>
        <p className="as-quiet">Explore Business Pulse →</p>
      </section>
      <section className="as-card">
        <p className="as-kicker">CASH FLOW · 14 DAYS</p>
        <p className="as-figure">₹1,50,000</p>
        <p className="as-muted">net positive</p>
        <p className="as-muted">₹8.40L inflow · ₹6.90L outflow</p>
        <span className="as-pill as-pill-teal">COMFORTABLE</span>
        <p className="as-muted">Major receivable expected in 8 days</p>
        <p className="as-quiet">See what’s ahead →</p>
      </section>
    </div>
  );
}

function BusinessDecisions({ onOpen }: { onOpen?: (stage: StageId) => void }) {
  return (
    <div className="as-stack">
      <p className="as-kicker as-rose">DECISIONS · 2 NEED YOU</p>
      <article className="as-card as-choice">
        <img src="/screens/biz-shield.svg" alt="" />
        <p className="as-strong">Increase reserve coverage</p>
        <p className="as-muted">Reserve coverage is below the 90-day target.</p>
      </article>
      <article className="as-card as-choice">
        <img src="/screens/biz-shield-2.svg" alt="" />
        <p className="as-strong">Review customer concentration</p>
        <p className="as-muted">Top customer contributes 42% of recent receipts.</p>
      </article>
      <p className="as-quiet">View Decisions →</p>
      <AppNav active="decisions" onOpen={onOpen} />
    </div>
  );
}

function BusinessMissions({ onOpen }: { onOpen?: (stage: StageId) => void }) {
  return (
    <div className="as-stack">
      <p className="as-kicker">MISSIONS · 2 ACTIVE</p>
      <div className="as-ring as-ring-sm" aria-hidden="true">
        <img src="/screens/biz-ring.svg" alt="" />
        <img src="/screens/biz-track.svg" alt="" />
        <img src="/screens/biz-fill.svg" alt="" />
        <b>59%</b>
      </div>
      <p className="as-strong">Strengthen Financial Protection</p>
      <p className="as-teal">53 / 90 days · 59% · On track</p>
      <hr />
      <p className="as-strong">Reduce Business Dependency</p>
      <p className="as-muted">Customer concentration · 42% → target ≤35%</p>
      <span className="as-track is-rose"><i style={{ width: "72%" }} /><b /></span>
      <Gold onClick={() => onOpen?.("missions")}>View Missions →</Gold>
      <AppNav active="missions" onOpen={onOpen} />
    </div>
  );
}

function BusinessMile({ onOpen }: { onOpen?: (stage: StageId) => void }) {
  return (
    <div className="as-stack">
      <p className="as-kicker">M.I.L.E.</p>
      <p className="as-muted">Money Impact & Business Evolution</p>
      <img className="as-biz-icon" src="/screens/biz-sprout.svg" alt="" />
      <p className="as-figure">₹84,000</p>
      <p className="as-muted">verified business financial impact</p>
      <p className="as-muted">+₹18,000 this month · Protection ↑</p>
      <Gold onClick={() => onOpen?.("mile")}>See Business M.I.L.E. →</Gold>
      <AppNav active="mile" onOpen={onOpen} />
    </div>
  );
}
