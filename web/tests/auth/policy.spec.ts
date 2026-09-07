import { expect, test } from "@playwright/test";
import { safeRedirect, verifiedLinkUserId } from "../../lib/auth-policy";
import authConfig from "../../auth.config";

const base = "https://tileforge.example";

test("preserves local callback paths and query strings", () => {
  expect(safeRedirect("/settings?tab=accounts", base)).toBe(`${base}/settings?tab=accounts`);
  expect(safeRedirect(`${base}/my-tilesets`, base)).toBe(`${base}/my-tilesets`);
});

for (const target of [
  "https://tileforge.example.attacker.test/",
  "https://tileforge.example@attacker.test/",
  "//attacker.test/",
  "/\\attacker.test/",
  "javascript:alert(1)",
  "http://[invalid",
]) {
  test(`rejects external or malformed redirect: ${target}`, () => {
    expect(safeRedirect(target, base)).toBe(base);
  });
}

test("link intent requires the same user in a verified session", () => {
  expect(verifiedLinkUserId("victim", "attacker")).toBeUndefined();
  expect(verifiedLinkUserId("victim", undefined)).toBeUndefined();
  expect(verifiedLinkUserId(undefined, "user")).toBeUndefined();
  expect(verifiedLinkUserId("user", "user")).toBe("user");
});

const salt = "tileforge.session-token";
test("existing sessions survive signing-key rotation", async () => {
  const token = await authConfig.jwt.encode({ token: { sub: "user" }, secret: "previous", salt });
  const decoded = await authConfig.jwt.decode({ token, secret: ["current", "previous"], salt });
  expect(decoded?.sub).toBe("user");
  expect(await authConfig.jwt.decode({ token, secret: "wrong", salt })).toBeNull();
});

test("session encoding honors maxAge and rejects expired tokens", async () => {
  const token = await authConfig.jwt.encode({ token: { sub: "user" }, secret: "secret", salt, maxAge: -1 });
  expect(await authConfig.jwt.decode({ token, secret: "secret", salt })).toBeNull();
});
