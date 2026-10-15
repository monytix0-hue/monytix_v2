export const site = {
  name: "Monytix",
  line: "Life Happens in Decisions.",
  descriptor: "Your Financial Decision OS.",
  splashTagline: "Adaptive Financial Intelligence",
  splashCategory: "India's Decision Layer for Money",
  company: "MagnatePoint Technologies Pvt. Ltd.",
  year: 2026,
} as const;

export const socialLinks: { href: string; label: string }[] = [
  // Add a URL here when the profile exists. Empty entries stay off the footer.
  { href: "", label: "LinkedIn" },
  { href: "", label: "Instagram" },
];

export type Segment = "yellow" | "cyan" | "orange" | "navy";
export type World = "personal" | "business";
export type StageId = "live" | "decisions" | "missions" | "mile";
export type Interest = "personal" | "business" | "both";

export const fragments: { id: Segment; label: string; phrase: string }[] = [
  { id: "yellow", label: "A purchase", phrase: "A purchase." },
  { id: "cyan", label: "A dream", phrase: "A dream." },
  { id: "orange", label: "A commitment", phrase: "A commitment." },
  { id: "navy", label: "An opportunity", phrase: "A business opportunity." },
];

export const stages: {
  id: StageId;
  label: string;
  title: string;
  personal: string;
  business: string;
}[] = [
  {
    id: "live",
    label: "Live",
    title: "Know where you stand.",
    personal: "Understand what’s happening with your finances and what deserves your attention.",
    business: "Business financial health and cash flow — understand the position you are in.",
  },
  {
    id: "decisions",
    label: "Decisions",
    title: "Know what matters.",
    personal: "Explore your choices, understand their implications and make informed financial decisions.",
    business: "Business financial decisions — explore the choices that shape what you do next.",
  },
  {
    id: "missions",
    label: "Missions",
    title: "Turn intentions into action.",
    personal: "Take meaningful steps toward your financial priorities, one mission at a time.",
    business: "Actions toward business financial priorities, one mission at a time.",
  },
  {
    id: "mile",
    label: "Mile",
    title: "See how far you’ve come.",
    personal: "Recognise your progress, understand your journey and keep moving toward what matters.",
    business: "Business financial progress — recognise the journey and keep moving.",
  },
];

export const personalQuestions = [
  {
    id: "afford",
    question: "Can I afford this?",
    line: "Understand how a purchase fits into your financial life.",
    screen: "cash" as const,
  },
  {
    id: "saving",
    question: "Am I saving enough?",
    line: "See how your financial habits support your future.",
    screen: "mission" as const,
  },
  {
    id: "loan",
    question: "Should I take that loan?",
    line: "Explore the financial implications before committing.",
    screen: "decision" as const,
  },
  {
    id: "dream",
    question: "Can I pursue this dream?",
    line: "Understand what it takes to move closer to your goals.",
    screen: "goal" as const,
  },
];

export const businessQuestions = [
  {
    id: "cashflow",
    question: "Is my cash flow healthy?",
    line: "Understand the financial position of your business.",
    screen: "bcash" as const,
  },
  {
    id: "expand",
    question: "Can I afford to expand?",
    line: "Explore your readiness before making the next move.",
    screen: "breserve" as const,
  },
  {
    id: "going",
    question: "Where is my money going?",
    line: "Recognise spending patterns and areas that need attention.",
    screen: "battention" as const,
  },
  {
    id: "focus",
    question: "What should I focus on next?",
    line: "Identify financial priorities that matter to your business.",
    screen: "bdecisions" as const,
  },
];

export const weights = [
  { name: "Time", line: "Timing, and when money is needed." },
  { name: "Comfort", line: "Everyday flexibility." },
  { name: "Risk", line: "Exposure to loss." },
  { name: "Obligations", line: "Commitments already owed." },
  { name: "Identity", line: "Declared priorities." },
  { name: "Relationships", line: "Declared dependants and shared duties." },
  { name: "Opportunity", line: "Room to act." },
  { name: "Attention", line: "Need for active management." },
  { name: "Resilience", line: "Capacity to absorb a shock." },
  { name: "Legacy", line: "A declared long horizon." },
];

export const intelligence = [
  { name: "Understand", line: "Know where you stand." },
  { name: "Anticipate", line: "Recognise what may lie ahead." },
  { name: "Decide", line: "Explore your choices with greater clarity." },
  { name: "Act", line: "Take meaningful steps forward." },
  { name: "Improve", line: "Build on your decisions and progress." },
];

export const thread = [
  { id: "hero", label: "Hero" },
  { id: "life", label: "Life" },
  { id: "worlds", label: "Worlds" },
  { id: "explore", label: "Explore" },
  { id: "questions", label: "Questions" },
  { id: "intelligence", label: "Intelligence" },
  { id: "philosophy", label: "Philosophy" },
  { id: "waitlist", label: "Waitlist" },
];
