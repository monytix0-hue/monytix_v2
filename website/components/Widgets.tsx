export type ScreenId =
  | "cash"
  | "decision"
  | "mission"
  | "goal"
  | "mile"
  | "pulse"
  | "bcash"
  | "bdecisions"
  | "bmission"
  | "bmile"
  | "breserve"
  | "battention";

function Ring({ value, color }: { value: number; color: string }) {
  const radius = 46;
  const circ = 2 * Math.PI * radius;
  return (
    <div className="ring-wrap" aria-hidden="true">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e3e5e5" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circ} ${circ}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

export function Phone({
  world,
  children,
}: {
  world: "personal" | "business";
  children: React.ReactNode;
}) {
  return (
    <div className={`phone phone-${world}`}>
      <div className="phone-screen">{children}</div>
    </div>
  );
}

export function Screen({ id }: { id: ScreenId }) {
  if (id === "cash") return <CashCard />;
  if (id === "decision") return <DecisionCard />;
  if (id === "mission" || id === "goal") return <MissionCard />;
  if (id === "mile") return <MileCard />;
  if (id === "pulse") return <PulseCard />;
  if (id === "bcash") return <BusinessCash />;
  if (id === "bdecisions") return <BusinessDecisions />;
  if (id === "bmission") return <BusinessMissions />;
  if (id === "bmile") return <BusinessMile />;
  if (id === "breserve") return <ReserveCard />;
  return <AttentionCard />;
}

function CashCard() {
  return (
    <article className="widget w-cash">
      <div className="w-row">
        <span className="w-kicker">Cash flow</span>
        <span className="pill pill-mint">14 days</span>
      </div>
      <div>
        <span className="amount">₹41,400</span> flexible
      </div>
      <div className="bar" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="w-row">
        <span>₹72,600 available</span>
        <span>₹31,200 committed</span>
      </div>
      <span className="pill pill-mint">Comfortable</span>
      <p>Salary expected in 11 days</p>
      <span className="w-btn">See what’s ahead →</span>
    </article>
  );
}

function DecisionCard() {
  return (
    <article className="widget w-decision">
      <div className="w-row">
        <span className="w-kicker">Decisions</span>
        <span className="pill pill-coral">2 need you</span>
      </div>
      <h3>Strengthen your emergency cushion</h3>
      <p>Your buffer has reduced.</p>
      <span className="w-btn">View Decisions →</span>
    </article>
  );
}

function MissionCard() {
  return (
    <article className="widget w-goal">
      <div className="w-row">
        <span className="w-kicker">Missions</span>
        <span className="pill pill-lav">2 active</span>
      </div>
      <Ring value={37} color="#003731" />
      <h3>Home Fund</h3>
      <p>
        <b>₹1.84L / ₹5L</b>
      </p>
      <p>₹12K this month</p>
      <span className="w-btn">View Missions →</span>
    </article>
  );
}

function MileCard() {
  return (
    <article className="widget w-impact">
      <span className="w-kicker">M.I.L.E.</span>
      <p>Money Impact & Life Evolution</p>
      <div className="amount">₹38,400</div>
      <p>positive financial impact</p>
      <div className="w-row">
        <span className="pill pill-gold">+₹6,200 this month</span>
        <span className="pill pill-mint">Resilience ↑</span>
      </div>
      <span className="w-btn">See your M.I.L.E. →</span>
    </article>
  );
}

function PulseCard() {
  return (
    <article className="widget w-biz">
      <div className="w-row">
        <span className="w-kicker">Business pulse</span>
        <span className="pill pill-pos">Updated today</span>
      </div>
      <h3>Stable</h3>
      <p>Cash stability is holding, while obligations and customer dependency need attention.</p>
      <div className="w-row">
        <span className="pill pill-pos">2 improving</span>
        <span className="pill pill-att">2 watch</span>
      </div>
    </article>
  );
}

function BusinessCash() {
  return (
    <article className="widget w-biz-raised">
      <div className="w-row">
        <span className="w-kicker">Cash flow</span>
        <span className="pill pill-pos">14 days</span>
      </div>
      <div>
        <span className="amount">₹1,50,000</span> net positive
      </div>
      <div className="w-row">
        <span>₹8.40L inflow</span>
        <span>₹6.90L outflow</span>
      </div>
      <span className="pill pill-pos">Comfortable</span>
      <p>Major receivable expected in 8 days</p>
    </article>
  );
}

function BusinessDecisions() {
  return (
    <div className="stack">
      <div className="w-row">
        <span className="w-kicker">Decisions</span>
        <span className="pill pill-att">2 need you</span>
      </div>
      <div className="mini-grid">
        <article className="mini">
          <b>Increase reserve coverage</b>
          Reserve coverage is below the 90-day target.
        </article>
        <article className="mini">
          <b>Review customer concentration</b>
          Top customer contributes 42% of recent receipts.
        </article>
      </div>
    </div>
  );
}

function BusinessMissions() {
  return (
    <article className="widget w-biz-raised">
      <div className="w-row">
        <span className="w-kicker">Missions</span>
        <span className="pill pill-pos">2 active</span>
      </div>
      <Ring value={59} color="#146F65" />
      <h3>Strengthen Financial Protection</h3>
      <p>53 / 90 days · 59% · On track</p>
    </article>
  );
}

function BusinessMile() {
  return (
    <article className="widget w-biz-raised">
      <span className="w-kicker">M.I.L.E.</span>
      <p>Money Impact & Business Evolution</p>
      <div className="amount">₹84,000</div>
      <p>verified business financial impact</p>
      <div className="w-row">
        <span className="pill pill-pos">+₹18,000 this month</span>
        <span className="pill pill-pos">Protection ↑</span>
      </div>
    </article>
  );
}

function ReserveCard() {
  return (
    <article className="widget w-biz">
      <span className="w-kicker">For you</span>
      <h3>Reserve coverage is below target</h3>
      <p>Current coverage is 53 days against a 90-day target.</p>
      <BusinessCash />
    </article>
  );
}

function AttentionCard() {
  return (
    <article className="widget w-biz">
      <div className="w-row">
        <span className="w-kicker">For you</span>
        <span className="pill pill-att">2 changes</span>
      </div>
      <h3>Two business shifts are worth a look</h3>
      <p>Operating spend is ₹48,000 above its recent pace.</p>
      <p>Current coverage is 53 days against a 90-day target.</p>
    </article>
  );
}

export function screenFor(world: "personal" | "business", stage: "live" | "decisions" | "missions" | "mile"): ScreenId {
  if (world === "personal") {
    if (stage === "live") return "cash";
    if (stage === "decisions") return "decision";
    if (stage === "missions") return "mission";
    return "mile";
  }
  if (stage === "live") return "pulse";
  if (stage === "decisions") return "bdecisions";
  if (stage === "missions") return "bmission";
  return "bmile";
}
