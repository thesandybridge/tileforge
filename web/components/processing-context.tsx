"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const ProcessingContext = createContext<{
  processing: boolean;
  setProcessing: (v: boolean) => void;
}>({ processing: false, setProcessing: () => {} });

export function ProcessingProvider({ children }: { children: ReactNode }) {
  const [processing, setProcessing] = useState(false);
  return (
    <ProcessingContext.Provider value={{ processing, setProcessing }}>
      {children}
    </ProcessingContext.Provider>
  );
}

export function useProcessing() {
  return useContext(ProcessingContext);
}
