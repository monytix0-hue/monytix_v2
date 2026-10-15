import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description: "Write to Monytix.",
};

export default function ContactPage() {
  return (
    <article className="wrap legal">
      <p className="eyebrow">Contact</p>
      <h1>Write to Monytix.</h1>
      <p>Tell us what decision is in front of you. We read every note.</p>
      <ContactForm />
    </article>
  );
}
