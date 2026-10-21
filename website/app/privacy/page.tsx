import type { Metadata } from "next";
import { Paper } from "@/components/Paper";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Monytix handles waitlist and contact details.",
};

export default function PrivacyPage() {
  return (
    <Paper>
      <article className="wrap legal prose">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p>This page describes the marketing site run by {site.company} (“we”). It covers the waitlist and the contact form. It is not a description of the Monytix product once it is available.</p>
        <h2>What we collect</h2>
        <p>If you join the waitlist we store your name, email, interest (Personal, Business, or Both), the page you joined from, the time of registration, and, if you choose to give them, your country and business name. If you write to us we store your name, email, message, and the time it was sent. We also store that you consented to hear from us.</p>
        <h2>Why we collect it</h2>
        <p>We use these details to tell you when your Monytix experience is ready, to understand whether you are interested in Personal, Business, or both, and to reply if you contacted us. We do not sell this information.</p>
        <h2>How long we keep it</h2>
        <p>We keep waitlist and contact records until the product invitation has been sent and a reasonable period after, or until you ask us to delete them, whichever comes first.</p>
        <h2>Asking for a change</h2>
        <p>To ask for access, correction, or deletion, use the contact form and include the email address you registered with.</p>
      </article>
    </Paper>
  );
}
