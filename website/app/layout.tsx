import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import { WaitlistSheet } from "@/components/WaitlistSheet";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Monytix — Life Happens in Decisions",
    template: "%s — Monytix",
  },
  description:
    "Monytix is your Financial Decision OS. Helping individuals and businesses understand their finances, navigate choices and move forward with confidence.",
};

export const viewport: Viewport = {
  themeColor: "#0D1218",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <a className="skip" href="#main">
            Skip to content
          </a>
          <Nav />
          <main id="main">{children}</main>
          <Footer />
          <WaitlistSheet />
        </Providers>
      </body>
    </html>
  );
}
