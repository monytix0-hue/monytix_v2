import Link from "next/link";
import { site, socialLinks } from "@/lib/site";
import { Wordmark } from "./Wordmark";

export function Footer() {
  const social = socialLinks.filter((item) => item.href.length > 0);

  return (
    <footer className="foot">
      <div className="wrap foot-grid">
        <div>
          <Wordmark height={40} />
          <p>{site.line}</p>
          <p>{site.descriptor}</p>
        </div>
        <div>
          <h2>Monytix</h2>
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
        </div>
        <div>
          <h2>Explore</h2>
          <Link href="/personal">Personal</Link>
          <Link href="/business">Business</Link>
          <Link href="/#live">Live</Link>
          <Link href="/#decisions">Decisions</Link>
          <Link href="/#missions">Missions</Link>
          <Link href="/#mile">Mile</Link>
        </div>
        <div>
          <h2>Philosophy</h2>
          <Link href="/#philosophy">Life Happens in Decisions</Link>
          <Link href="/book">Discover the Book</Link>
        </div>
        <div>
          <h2>Connect</h2>
          <Link href="/contact">Contact</Link>
          {social.map((item) => (
            <a key={item.label} href={item.href}>
              {item.label}
            </a>
          ))}
          <h2>Legal</h2>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
        </div>
      </div>
      <div className="wrap foot-base">
        <span>MONYTIX — {site.line}</span>
        <span>
          © {site.year} {site.company} All rights reserved.
        </span>
      </div>
    </footer>
  );
}
