"use client";

import { useState } from "react";
import { CheckCheck, Copy, Key, Laptop, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/hooks/use-api-key";
import { Button } from "@/components/ui/button";

export function ApiKeyCard() {
  const { data: keys = [], isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (isLoading) return null;

  return (
    <div className="rounded-lg border p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Key className="text-muted-foreground h-5 w-5" />
          <div><p className="text-sm font-medium">API Keys &amp; CLI Devices</p><p className="text-muted-foreground text-xs">Manage service credentials and authenticated computers</p></div>
        </div>
        <Button size="sm" disabled={createKey.isPending} onClick={() => createKey.mutate(undefined, { onSuccess: (data) => { setNewKey(data.key); toast.success("API key generated"); } })}>New service key</Button>
      </div>
      {newKey && <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
        <p className="mb-2 text-xs font-medium text-amber-400">Copy this key now. It will not be shown again.</p>
        <div className="flex gap-2"><code className="flex-1 break-all text-xs">{newKey}</code><Button variant="ghost" size="sm" onClick={async () => { if (await copyToClipboard(newKey, "API key")) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>{copied ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>
      </div>}
      <div className="space-y-3">
        {keys.length === 0 && <p className="text-muted-foreground text-sm">No API keys or CLI devices are authorized.</p>}
        {keys.map((key) => <div key={key.id} className="flex items-start gap-3 rounded-md border p-3">
          {key.device_info ? <Laptop className="text-primary mt-0.5 h-4 w-4" /> : <Key className="text-muted-foreground mt-0.5 h-4 w-4" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{key.name}</p>
            <p className="text-muted-foreground text-xs"><code>{key.key_prefix}…</code> · {key.scopes.join(", ")}</p>
            {key.device_info && <p className="text-muted-foreground text-xs">{key.device_info.os} · {key.device_info.arch}</p>}
            <p className="text-muted-foreground/70 text-xs">Created {new Date(key.created_at).toLocaleDateString()} · {key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleString()}` : "Never used"}</p>
          </div>
          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" disabled={revokeKey.isPending} onClick={() => revokeKey.mutate(key.id, { onSuccess: () => toast.success(`${key.name} revoked`) })}>{revokeKey.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}<span className="sr-only">Revoke {key.name}</span></Button>
        </div>)}
      </div>
    </div>
  );
}
