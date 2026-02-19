"use client";

import { createContext, useContext, useCallback, useState, type ReactNode } from "react";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  endpoint: string;
}

interface RateLimitContextValue {
  limits: Record<string, RateLimitInfo>;
  updateFromHeaders: (headers: Headers, endpoint: string) => void;
  isApproachingLimit: (endpoint?: string) => boolean;
  lowestRemaining: RateLimitInfo | null;
}

const RateLimitContext = createContext<RateLimitContextValue>({
  limits: {},
  updateFromHeaders: () => {},
  isApproachingLimit: () => false,
  lowestRemaining: null,
});

export function RateLimitProvider({ children }: { children: ReactNode }) {
  const [limits, setLimits] = useState<Record<string, RateLimitInfo>>({});

  const updateFromHeaders = useCallback((headers: Headers, endpoint: string) => {
    const limit = headers.get("X-RateLimit-Limit");
    const remaining = headers.get("X-RateLimit-Remaining");
    const reset = headers.get("X-RateLimit-Reset");

    if (limit && remaining && reset) {
      setLimits((prev) => ({
        ...prev,
        [endpoint]: {
          limit: parseInt(limit, 10),
          remaining: parseInt(remaining, 10),
          reset: parseInt(reset, 10),
          endpoint,
        },
      }));
    }
  }, []);

  const isApproachingLimit = useCallback(
    (endpoint?: string) => {
      if (endpoint) {
        const info = limits[endpoint];
        if (!info) return false;
        return info.remaining <= 3;
      }
      // Check all endpoints
      return Object.values(limits).some((info) => info.remaining <= 3);
    },
    [limits]
  );

  const lowestRemaining = Object.values(limits).reduce<RateLimitInfo | null>(
    (lowest, info) => {
      if (!lowest || info.remaining < lowest.remaining) return info;
      return lowest;
    },
    null
  );

  return (
    <RateLimitContext.Provider
      value={{ limits, updateFromHeaders, isApproachingLimit, lowestRemaining }}
    >
      {children}
    </RateLimitContext.Provider>
  );
}

export function useRateLimit() {
  return useContext(RateLimitContext);
}
