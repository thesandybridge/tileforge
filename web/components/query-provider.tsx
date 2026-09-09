"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

const PRIVATE_QUERY_ROOTS = new Set([
  "user",
  "api-keys",
  "tilesets",
  "tileset",
  "projects",
  "jobs",
  "notifications",
  "linked-accounts",
  "pmtiles-url",
]);

function PrivateQueryCacheGuard({ queryClient }: { queryClient: QueryClient }) {
  const { data: session, status } = useSession();
  const previousIdentity = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (status === "loading") return;
    const identity = session?.user?.id ?? null;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) {
      const currentKey = identity ?? "anonymous";
      queryClient.removeQueries({
        predicate: (query) => {
          const [root, owner] = query.queryKey;
          return typeof root === "string" && PRIVATE_QUERY_ROOTS.has(root) && owner !== currentKey;
        },
      });
    }
    previousIdentity.current = identity;
  }, [queryClient, session?.user?.id, status]);

  return null;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute before background refetch
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PrivateQueryCacheGuard queryClient={queryClient} />
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
