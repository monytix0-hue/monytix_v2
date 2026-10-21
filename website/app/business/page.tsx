import type { Metadata } from "next";
import { WorldView } from "@/components/WorldView";

export const metadata: Metadata = {
  title: "Business",
  description: "Your business. Your decisions. Your future. Monytix Business helps you understand your finances and move forward.",
};

export default function BusinessPage() {
  return <WorldView world="business" />;
}
