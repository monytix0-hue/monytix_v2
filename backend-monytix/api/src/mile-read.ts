export type MileFact = {
  id: string;
  family: string | null;
  miles: number;
  impact: number;
  occurred_at: string;
  mission_id: string | null;
  mission_title: string | null;
  decision_id: string | null;
  decision_title: string | null;
  event_type: string;
};

const FAMILIES = [
  { code: "MP", title: "Safety", line: "Protection & resilience", built: "Safety & resilience", report: "Money protected" },
  { code: "DR", title: "Debt", line: "Commitments reduced", built: "Debt & commitments", report: "Debt reduced" },
  { code: "MS", title: "Savings", line: "Cash retained", built: "Saving & cash flow", report: "Money saved" },
  { code: "WB", title: "Wealth", line: "Future assets built", built: "Wealth building", report: "Wealth built" },
  { code: "GF", title: "Opportunity", line: "New capacity opened", built: "Opportunity", report: "Goals funded" },
  { code: "FC", title: "Freedom", line: "More financial flexibility", built: "Freedom", report: "Capacity created" },
] as const;

const emptySummary = {
  contract: "mile-summary-v0.1" as const,
  empty_state: true,
  period: { available: false },
  distance: { available: false },
  months: [] as unknown[],
  impact: { available: false },
  outcomes: [] as unknown[],
  movement: { available: false },
  report: { available: false },
  lifetime: { available: false },
};

function familyOf(code: string | null) {
  return FAMILIES.find((item) => item.code === code) ?? null;
}

function money(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function milesLabel(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function monthKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date);
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date >= start && date <= end;
}

export function phoneMileSummary(events: MileFact[]) {
  const finalized = events.filter((item) => item.id);
  if (finalized.length === 0) return emptySummary;
  const latest = finalized.reduce((max, item) => (item.occurred_at > max ? item.occurred_at : max), finalized[0]?.occurred_at || "");
  const end = new Date(latest);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  const recent = finalized.filter((item) => inRange(item.occurred_at, start, end));
  const year = end.getUTCFullYear();
  const yearly = finalized.filter((item) => new Date(item.occurred_at).getUTCFullYear() === year);
  const recentMiles = recent.reduce((sum, item) => sum + item.miles, 0);
  const recentImpact = recent.reduce((sum, item) => sum + item.impact, 0);
  const lifetimeMiles = finalized.reduce((sum, item) => sum + item.miles, 0);
  const lifetimeImpact = finalized.reduce((sum, item) => sum + item.impact, 0);
  const monthTotals = new Map<string, number>();
  for (const item of recent) {
    const key = monthKey(item.occurred_at);
    if (!key) continue;
    monthTotals.set(key, (monthTotals.get(key) || 0) + item.miles);
  }
  const outcomes = FAMILIES.map((family) => {
    const rows = recent.filter((item) => item.family === family.code);
    const amount = rows.reduce((sum, item) => sum + item.impact, 0);
    const awarded = rows.reduce((sum, item) => sum + item.miles, 0);
    if (amount <= 0 && awarded <= 0) return null;
    const drivers = [...new Set(rows.map((item) => item.mission_title).filter((title): title is string => Boolean(title)))];
    const newest = [...rows].sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))[0];
    return {
      id: family.code,
      title: family.title,
      line: family.line,
      amount: amount > 0 ? money(amount) : null,
      miles: milesLabel(awarded),
      share: recentImpact > 0 ? `${Math.round((amount / recentImpact) * 100)}%` : null,
      drivers: drivers.join(" · "),
      recent: newest ? whenLabel(newest.occurred_at) : "",
      actions: String(rows.length),
    };
  }).filter((item) => item !== null);
  const leader = [...FAMILIES].sort((left, right) => {
    const leftMiles = recent.filter((item) => item.family === left.code).reduce((sum, item) => sum + item.miles, 0);
    const rightMiles = recent.filter((item) => item.family === right.code).reduce((sum, item) => sum + item.miles, 0);
    return rightMiles - leftMiles;
  })[0];
  const yearImpact = (code: string) => yearly.filter((item) => item.family === code).reduce((sum, item) => sum + item.impact, 0);
  const evolution = [...FAMILIES].sort((left, right) => yearImpact(right.code) - yearImpact(left.code))[0];
  const decisions = new Set(yearly.map((item) => item.decision_id).filter(Boolean)).size;
  const missions = new Set(yearly.map((item) => item.mission_id).filter(Boolean)).size;
  const milestones = yearly.filter((item) => item.event_type === "MISSION_MILESTONE" || item.event_type === "MISSION_COMPLETION").length;
  const yearBuckets = new Map<string, number>();
  for (const item of finalized) {
    const label = String(new Date(item.occurred_at).getUTCFullYear());
    yearBuckets.set(label, (yearBuckets.get(label) || 0) + item.miles);
  }
  return {
    contract: "mile-summary-v0.1" as const,
    empty_state: false,
    period: { available: true, label: "Last 3 months" },
    distance: { available: true, value: milesLabel(recentMiles), line: "Across the last 3 months." },
    months: [...monthTotals.entries()]
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ label: monthLabel(key), value: milesLabel(value) })),
    impact: { available: recentImpact > 0, amount: recentImpact > 0 ? money(recentImpact) : null, line: "Positive financial impact" },
    outcomes,
    movement: { available: true, line: `${leader?.title || "Safety"} led this period.` },
    report: {
      available: true,
      year: String(year),
      distance: milesLabel(yearly.reduce((sum, item) => sum + item.miles, 0)),
      impact: money(yearly.reduce((sum, item) => sum + item.impact, 0)),
      line: "Decisions, missions, and verified impact from this year.",
      evolution: yearImpact(evolution?.code || "") > 0 ? evolution?.title || null : null,
      numbers: [
        ...FAMILIES.slice(0, 4).map((family) => ({ label: family.report, value: money(yearImpact(family.code)) })),
        { label: "Decisions carried through", value: String(decisions) },
        { label: "Missions advanced", value: String(missions) },
        { label: "Milestones reached", value: String(milestones) },
      ],
    },
    lifetime: {
      available: true,
      distance: milesLabel(lifetimeMiles),
      impact: money(lifetimeImpact),
      line: "Your financial evolution doesn't reset each year. It keeps building.",
      years: [...yearBuckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({ label, value: milesLabel(value) })),
      built: FAMILIES.map((family) => {
        const awarded = finalized.filter((item) => item.family === family.code).reduce((sum, item) => sum + item.miles, 0);
        return awarded > 0 ? { label: family.built, value: milesLabel(awarded) } : null;
      }).filter((item) => item !== null),
    },
  };
}

export function phoneMileEvents(events: MileFact[]) {
  return {
    contract: "mile-events-v0.1" as const,
    events: [...events]
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
      .map((item) => ({
        id: item.id,
        title: item.mission_title || familyOf(item.family)?.title || "Verified impact",
        line: item.impact > 0 ? money(item.impact) : familyOf(item.family)?.line || "Verified impact",
        miles: milesLabel(item.miles),
      })),
  };
}

export function phoneMileEvent(events: MileFact[], eventId: string) {
  const item = events.find((row) => row.id === eventId);
  if (!item) return null;
  const family = familyOf(item.family);
  return {
    event: {
      id: item.id,
      title: item.mission_title || family?.title || "Verified impact",
      line: item.impact > 0 ? money(item.impact) : family?.line || "Verified impact",
      miles: milesLabel(item.miles),
      when: whenLabel(item.occurred_at),
      changed: item.impact > 0 ? `${money(item.impact)} counted toward ${family?.title || "this outcome"}.` : `${milesLabel(item.miles)} miles recorded.`,
      decision_id: item.decision_id,
      decision: item.decision_title,
    },
  };
}
