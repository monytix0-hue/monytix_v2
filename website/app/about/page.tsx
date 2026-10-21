import type { Metadata } from "next";
import Link from "next/link";
import { Paper } from "@/components/Paper";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "Monytix is a Financial Decision OS for personal life and business. Life happens in decisions.",
};

export default function AboutPage() {
  return (
    <Paper>
      <article className="wrap legal prose">
        <p className="eyebrow">About</p>
        <h1>Monytix is a financial decision OS.</h1>
        <p>
          {site.line} Every decision shapes what comes next. Monytix helps individuals and businesses understand their
          finances, navigate choices and move forward with confidence.
        </p>
        <p>
          Personal and Business are two experiences in one connected system: Live, Decisions, Missions and Mile. The
          thinking comes from the book Life Happens in Decisions. The product helps you navigate the choices the book
          asks you to take seriously.
        </p>
        <p>
          Monytix is built by {site.company}
        </p>
        <p>
          <Link href="/personal">Explore Personal</Link>
          {" · "}
          <Link href="/business">Explore Business</Link>
          {" · "}
          <Link href="/book">Discover the Book</Link>
        </p>
      </article>
    </Paper>
  );
}
