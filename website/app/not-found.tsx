import Link from "next/link";

export default function NotFound() {
  return (
    <section className="band">
      <div className="wrap">
        <p className="eyebrow">404</p>
        <h1 className="display">This page isn’t a decision we recognise.</h1>
        <p>
          <Link className="btn-gold" href="/">
            Back to Monytix
          </Link>
        </p>
      </div>
    </section>
  );
}
