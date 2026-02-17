import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id: string;
      plan: string;
      username: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    plan?: string;
    username?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    plan?: string;
    username?: string;
    avatarUrl?: string;
    apiToken?: string;
  }
}
