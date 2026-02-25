import NextAuth from "next-auth";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);
import { NextResponse } from "next/server";

const publicPaths = ["/", "/gallery", "/changelog", "/api/auth", "/billing", "/pricing", "/signin"];

function isPublic(pathname: string): boolean {
  if (publicPaths.includes(pathname)) return true;
  if (pathname.startsWith("/tilesets/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/stripe/")) return true;
  return false;
}

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow public routes, static assets, and images
  if (isPublic(pathname)) return NextResponse.next();

  // Require auth for protected routes (e.g. /my-tilesets)
  if (!req.auth) {
    const signInUrl = new URL("/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|wasm/|.*\\.worker\\.js).*)"],
};
