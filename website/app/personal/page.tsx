import type { Metadata } from "next";
import { WorldView } from "@/components/WorldView";

export const metadata: Metadata = {
  title: "Personal",
  description: "Your life. Your money. Your decisions. Monytix Personal helps you understand where you stand and choose with clarity.",
};

export default function PersonalPage() {
  return <WorldView world="personal" />;
}
