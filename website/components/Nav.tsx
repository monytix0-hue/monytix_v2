"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWaitlist } from "./Providers";
import { Wordmark } from "./Wordmark";

export function Nav() {
  const pathname = usePathname();
  const { openWaitlist } = useWaitlist();
  const [open, setOpen] = useState(false);
  const home = pathname === "/";
  const explore = home ? "#explore" : "/#explore";
  const philosophy = home ? "#philosophy" : "/#philosophy";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" aria-label="Monytix home">
          <Wordmark />
        </Link>
        <button
          className="nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Menu"}
        </button>
        <div id="site-menu" className={`nav-panel${open ? " is-open" : ""}`}>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/">Home</Link>
            <Link href="/personal">Personal</Link>
            <Link href="/business">Business</Link>
            <a href={explore}>Explore Monytix</a>
            <a href={philosophy}>Our Philosophy</a>
          </nav>
          <button className="btn-gold" type="button" onClick={() => openWaitlist("nav")}>
            Join Waitlist
          </button>
        </div>
      </div>
    </header>
  );
}
