"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useApiKey, useCreateApiKey, useRevokeApiKey } from "@/hooks/use-api-key";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Key, Copy, CheckCheck } from "lucide-react";

export function ApiKeyCard() {
  const { data: apiKey, isLoading } = useApiKey();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  function handleCreate() {
    createKey.mutate(undefined, {
      onSuccess: (data) => {
        setNewKey(data.key);
        setCopied(false);
        toast.success("API key generated");
      },
    });
  }

  function handleRegenerate() {
    setConfirmRegenerate(false);
    createKey.mutate(undefined, {
      onSuccess: (data) => {
        setNewKey(data.key);
        setCopied(false);
        toast.success("API key regenerated");
      },
    });
  }

  function handleRevoke() {
    revokeKey.mutate(undefined, {
      onSuccess: () => {
        setNewKey(null);
        toast.success("API key revoked");
      },
    });
  }

  async function handleCopy() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    toast("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) return null;

  return (
    <div className="rounded-lg border p-6">
      <div className="mb-4 flex items-center gap-3">
        <Key className="text-muted-foreground h-5 w-5" />
        <div>
          <p className="text-sm font-medium">API Key</p>
          <p className="text-muted-foreground text-xs">
            Use your API key to access tilesets in external apps
          </p>
        </div>
      </div>

      {newKey && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="mb-2 text-xs font-medium text-amber-400">
            Copy your key now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background px-2 py-1 text-xs font-mono">
              {newKey}
            </code>
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              {copied ? (
                <CheckCheck className="h-4 w-4 text-green-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {apiKey ? (
        <div>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
              {apiKey.key_prefix}...
            </code>
            <span className="text-muted-foreground text-xs">
              Created {new Date(apiKey.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmRegenerate(true)}
              disabled={createKey.isPending}
            >
              {createKey.isPending ? "Generating..." : "Regenerate"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRevoke}
              disabled={revokeKey.isPending}
              className="text-destructive hover:text-destructive"
            >
              {revokeKey.isPending ? "Revoking..." : "Revoke"}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={handleCreate} disabled={createKey.isPending} size="sm">
          <Key className="mr-2 h-4 w-4" />
          {createKey.isPending ? "Generating..." : "Generate API Key"}
        </Button>
      )}

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate your current key. Any applications using it
              will lose access until updated with the new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRegenerate}>
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
