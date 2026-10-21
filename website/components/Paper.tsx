"use client";

import { useEffect } from "react";

export function Paper({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.dataset.world = "paper";
    return () => {
      delete document.body.dataset.world;
    };
  }, []);
  return <>{children}</>;
}
