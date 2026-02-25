import { handlers } from "@/auth";
import { linkStore } from "@/lib/link-store";
import { LINK_COOKIE } from "@/auth";

export const POST = handlers.POST;

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LINK_COOKIE}=([^;]+)`));
  return linkStore.run(match?.[1], () => handlers.GET(req));
}
