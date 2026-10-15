import type { Metadata } from "next";
import { Paper } from "@/components/Paper";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms for using the Monytix marketing website.",
};

export default function TermsPage() {
  return (
    <Paper>
      <article className="wrap legal prose">
        <p className="eyebrow">Legal</p>
        <h1>Terms of Use</h1>
        <p>This website is operated by {site.company} By using it you agree to these terms.</p>
        <h2>The site</h2>
        <p>The pages describe Monytix, a financial decision system that is not yet generally available. Joining the waitlist expresses interest. It does not create an account, reserve a place for a fee, or promise a launch date.</p>
        <h2>Illustrations</h2>
        <p>Screens on this site show the product’s own interface language and sample figures. They illustrate Live, Decisions, Missions and Mile. They are not a statement of your finances and they are not an offer of credit, investment, or insurance.</p>
        <h2>Your messages</h2>
        <p>You agree that the name, email, and any message you send are accurate, and that we may use them to contact you about Monytix as described in the Privacy Policy.</p>
        <h2>The mark</h2>
        <p>The Monytix name, wordmark, and O-mark belong to {site.company} You may not copy them for another product or service.</p>
      </article>
    </Paper>
  );
}
