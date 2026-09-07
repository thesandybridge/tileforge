import type { NextRequest } from "next/server";
import { auth, handlers } from "@/auth";
import { linkStore } from "@/lib/link-store";
import { LINK_COOKIE } from "@/auth";
import { verifiedLinkUserId } from "@/lib/auth-policy";

export const POST = handlers.POST;

export async function GET(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/auth/callback/")) {
    return handlers.GET(req);
  }

  const requestedId = req.cookies.get(LINK_COOKIE)?.value;
  const session = requestedId ? await auth() : null;
  const userId = verifiedLinkUserId(requestedId, session?.user?.id);
  if (requestedId && !userId) {
    const response = new Response(null, {
      status: 302,
      headers: { Location: new URL("/signin?error=AccessDenied", req.url).href },
    });
    response.headers.append("Set-Cookie", `${LINK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
    return response;
  }

  const response = await linkStore.run(userId, () => handlers.GET(req));
  if (requestedId) {
    response.headers.append("Set-Cookie", `${LINK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  }
  return response;
}
