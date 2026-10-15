"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { stages, type StageId, type World } from "@/lib/site";
import { IphoneFrame } from "../IphoneFrame";
import { DecisionsFlow } from "../decisions/DecisionsFlow";
import { ExperienceScreen } from "../screens/AppScreens";

const phrases = ["From understanding", "to action.", "From action", "to progress."] as const;

const pips: Record<StageId, string> = {
  live: "#F9C515",
  decisions: "#55C2EF",
  missions: "#F47521",
  mile: "#8ABC9E",
};

export function ProductStage({
  locked,
  intro = true,
}: {
  locked?: World;
  intro?: boolean;
}) {
  const reduce = useReducedMotion();
  const [world, setWorld] = useState<World>(locked ?? "personal");
  const [step, setStep] = useState<StageId>("live");
  const current = stages.find((item) => item.id === step) ?? stages[0];

  useEffect(() => {
    if (locked) setWorld(locked);
  }, [locked]);

  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash === "live" || hash === "decisions" || hash === "missions" || hash === "mile") {
        setStep(hash);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  return (
    <section className={`band stage${intro ? "" : " is-plain"}`} id="explore">
      <div className="wrap">
        <div className="journey-head">
          <div>
            {intro ? <p className="eyebrow">Explore Monytix</p> : null}
            <h2 className={intro ? "journey-title" : "section-title"}>
              {intro ? "One connected financial experience." : "Four connected experiences."}
            </h2>
          </div>
          {intro ? (
            <div className="journey-aside">
              <p>Your financial life is constantly moving. Monytix brings everything together through four connected experiences.</p>
              {locked ? null : (
                <div className="switch" role="group" aria-label="Choose a world">
                  <button type="button" aria-pressed={world === "personal"} onClick={() => setWorld("personal")}>
                    Personal
                  </button>
                  <button type="button" aria-pressed={world === "business"} onClick={() => setWorld("business")}>
                    Business
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
        <div className="journey-path" role="tablist" aria-label="Product experiences">
          {stages.map((item, index) => (
            <button
              key={item.id}
              id={item.id}
              className="journey-node"
              type="button"
              role="tab"
              aria-selected={step === item.id}
              style={{ "--pip": pips[item.id] } as CSSProperties}
              onClick={() => setStep(item.id)}
            >
              {intro ? <em>{phrases[index]}</em> : null}
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
        <div className="journey-show" style={{ "--pip": pips[step] } as CSSProperties}>
          <AnimatePresence mode="wait">
            <motion.div
              className="journey-copy"
              key={`${world}-${step}-copy`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
            >
              <p className="journey-kicker">{current.label}</p>
              <h3>{current.title}</h3>
              <p className="lede">{world === "personal" ? current.personal : current.business}</p>
              <p>
                <a className="btn-gold" href={world === "personal" ? "/personal" : "/business"}>
                  Explore {world === "personal" ? "Personal" : "Business"}
                </a>
              </p>
            </motion.div>
          </AnimatePresence>
          <AnimatePresence mode="wait">
            <motion.div
              className="journey-screen"
              key={`${world}-${step}`}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
            >
              <IphoneFrame>
                {world === "personal" && step === "decisions" ? (
                  <DecisionsFlow world="personal" reduce={reduce} onOpen={setStep} />
                ) : (
                  <ExperienceScreen world={world} stage={step} onOpen={setStep} />
                )}
              </IphoneFrame>
            </motion.div>
          </AnimatePresence>
        </div>
        <p className="flow">Live → Decisions → Missions → Mile</p>
        <p className="journey-close">Your finances. Your choices. Your progress. Connected.</p>
      </div>
    </section>
  );
}
