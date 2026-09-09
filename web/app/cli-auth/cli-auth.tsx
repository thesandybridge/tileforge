"use client";

import { useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { Terminal } from "lucide-react";
import { createCliApiKey } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function validCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/callback";
  } catch { return false; }
}

export function CliAuth({ callback, state }: { callback: string; state: string }) {
  const { data: session, status } = useSession();
  const [error, setError] = useState("");
  const valid = validCallback(callback) && /^[a-f0-9]{48}$/.test(state);
  const authorize = async () => {
    if (!session?.accessToken || !valid) return;
    try {
      const result = await createCliApiKey(session.accessToken);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = callback;
      for (const [name, value] of [["token", result.key], ["state", state]]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authorization failed");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-16">
      <Card className="w-full border-border/50">
        <CardHeader><CardTitle className="flex items-center gap-2"><Terminal className="h-5 w-5" />Authorize TileForge CLI</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!valid ? <p className="text-destructive text-sm">This CLI authorization request is invalid.</p> : (
            <>
              <p className="text-muted-foreground text-sm">This creates a separate API key for the CLI on this computer. Existing service keys stay active.</p>
              {status === "unauthenticated" ? (
                <Button className="w-full" onClick={() => signIn("github", { callbackUrl: window.location.href })}>Sign in with GitHub</Button>
              ) : (
                <Button className="w-full" disabled={status === "loading"} onClick={authorize}>Authorize CLI</Button>
              )}
              {error && <p className="text-destructive text-sm">{error}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
