"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type WaitlistApi = {
  open: boolean;
  source: string;
  openWaitlist: (source?: string) => void;
  closeWaitlist: () => void;
};

const WaitlistContext = createContext<WaitlistApi | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("nav");
  const openWaitlist = useCallback((next = "nav") => {
    setSource(next);
    setOpen(true);
  }, []);
  const closeWaitlist = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, source, openWaitlist, closeWaitlist }),
    [open, source, openWaitlist, closeWaitlist],
  );
  return <WaitlistContext.Provider value={value}>{children}</WaitlistContext.Provider>;
}

export function useWaitlist() {
  const value = useContext(WaitlistContext);
  if (!value) throw new Error("Waitlist provider is missing");
  return value;
}
