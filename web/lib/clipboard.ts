import { toast } from "sonner";

export async function copyToClipboard(text: string, label: string = "Text") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
    return true;
  } catch {
    toast.error("Failed to copy to clipboard");
    return false;
  }
}
