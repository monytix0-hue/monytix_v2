import type { Metadata } from "next";
import { Paper } from "@/components/Paper";
import { WaitlistForm } from "@/components/WaitlistForm";
import { BookBand } from "@/components/home/BookBand";

export const metadata: Metadata = {
  title: "Life Happens in Decisions",
  description: "The book explores why decisions matter. Monytix helps you navigate them.",
};

export default function BookPage() {
  return (
    <Paper>
      <BookBand full />
      <section className="final" id="waitlist">
        <div className="wrap final-grid">
          <div>
            <h2 className="section-title">The book explores why. Monytix helps you navigate.</h2>
            <p>Be among the first to experience the decision-first approach in your financial life.</p>
          </div>
          <WaitlistForm source="/book" idPrefix="book" />
        </div>
      </section>
    </Paper>
  );
}
