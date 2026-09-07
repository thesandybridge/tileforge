import { defineConfig } from "@playwright/test";

// These tests exercise server auth policies without a browser, OAuth, or a DB.
export default defineConfig({
  testDir: "./tests/auth",
  reporter: "list",
});
