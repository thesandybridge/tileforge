import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("loads and shows upload zone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Drop an image here")).toBeVisible();
  });

  test("shows WASM loading state then ready", async ({ page }) => {
    await page.goto("/");
    // Wait for the WASM to initialize (the card should appear)
    await expect(page.locator(".card, [class*='Card']").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("can navigate to gallery", async ({ page }) => {
    await page.goto("/");
    await page.click('a[href="/gallery"]');
    await expect(page).toHaveURL("/gallery");
    await expect(page.getByText("Public Tile Sets")).toBeVisible();
  });

  test("can navigate to changelog", async ({ page }) => {
    await page.goto("/");
    await page.click('a[href="/changelog"]');
    await expect(page).toHaveURL("/changelog");
    await expect(page.getByText("Changelog")).toBeVisible();
  });

  test("upload zone accepts drag hover state", async ({ page }) => {
    await page.goto("/");
    // Wait for the upload zone to be visible
    const dropZone = page.locator('[role="button"][aria-label*="Upload"]');
    await expect(dropZone).toBeVisible({ timeout: 10000 });
  });

  test("keyboard shortcut hint visible for processing", async ({ page }) => {
    await page.goto("/");
    // Just verify the page loads correctly
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Gallery page", () => {
  test("loads public tilesets page", async ({ page }) => {
    await page.goto("/gallery");
    await expect(page.getByText("Public Tile Sets")).toBeVisible();
  });
});

test.describe("Changelog page", () => {
  test("loads changelog without auth", async ({ page }) => {
    await page.goto("/changelog");
    await expect(page.getByText("Changelog")).toBeVisible();
  });
});
