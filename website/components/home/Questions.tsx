"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { businessQuestions, personalQuestions } from "@/lib/site";
import type { ScreenId } from "../Widgets";
import { IphoneFrame } from "../IphoneFrame";
import { DecisionsFlow } from "../decisions/DecisionsFlow";
import { ExperienceScreen, stageForScreen } from "../screens/AppScreens";

type Item = { id: string; question: string; line: string; screen: ScreenId; world: "personal" | "business"; pip: string };

const pip: Record<string, string> = {
  afford: "#F9C515",
  saving: "#55C2EF",
  loan: "#F47521",
  dream: "#313A96",
  cashflow: "#8ABC9E",
  expand: "#F7C663",
  going: "#C4956A",
  focus: "#146F65",
};

const all: Item[] = [
  ...personalQuestions.map((item) => ({ ...item, world: "personal" as const, pip: pip[item.id] })),
  ...businessQuestions.map((item) => ({ ...item, world: "business" as const, pip: pip[item.id] })),
];

export function Questions({ world }: { world?: "personal" | "business" }) {
  const reduce = useReducedMotion();
  const list = world ? all.filter((item) => item.world === world) : all;
  const [active, setActive] = useState(list[0]?.id ?? "afford");
  const current = list.find((item) => item.id === active) ?? list[0];
  const personal = list.filter((item) => item.world === "personal");
  const business = list.filter((item) => item.world === "business");

  return (
    <section className="band desk-section" id="questions">
      <div className="wrap">
        <p className="eyebrow">Real-life decisions</p>
        <h2 className="section-title">Everyday questions. Meaningful decisions.</h2>
        <p className="lede">Whatever life brings, start with clarity.</p>
        <div className={`q-stage${world ? " is-world" : ""}`}>
          {personal.length ? (
            <div className="q-rail q-rail-personal">
              {world ? null : <p className="q-label">Personal</p>}
              {personal.map((item) => (
                <QuestionButton key={item.id} item={item} pressed={active === item.id} onSelect={setActive} />
              ))}
            </div>
          ) : null}
          {current ? (
            <div className="q-well" style={{ "--pip": current.pip } as CSSProperties}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                >
                  <p className="q-world">{current.world === "personal" ? "Personal" : "Business"}</p>
                  <IphoneFrame size="compact">
                    {current.world === "personal" && stageForScreen(current.screen) === "decisions" ? (
                      <DecisionsFlow world="personal" reduce={reduce} onOpen={() => undefined} />
                    ) : (
                      <ExperienceScreen world={current.world} stage={stageForScreen(current.screen)} compact />
                    )}
                  </IphoneFrame>
                  <p className="desk-copy">{current.line}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          ) : null}
          {business.length ? (
            <div className="q-rail q-rail-business">
              {world ? null : <p className="q-label">Business</p>}
              {business.map((item) => (
                <QuestionButton key={item.id} item={item} pressed={active === item.id} onSelect={setActive} />
              ))}
            </div>
          ) : null}
        </div>
        <p className="q-close">
          Every question begins with uncertainty. Every informed decision begins with understanding. Monytix helps you
          connect the two.
        </p>
      </div>
    </section>
  );
}

function QuestionButton({
  item,
  pressed,
  onSelect,
}: {
  item: Item;
  pressed: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className="q-line"
      type="button"
      aria-pressed={pressed}
      style={{ "--pip": item.pip } as CSSProperties}
      onClick={() => onSelect(item.id)}
    >
      <span>{item.question}</span>
      <i aria-hidden="true" />
    </button>
  );
}
