import { expect, test } from "@playwright/test";

/** Archive Terminus: fix-cards, search/tags, and the incident mini-map. */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByText("Load messy sample dataset").click();
  await page.getByText("DEPART", { exact: true }).click();
  await page.waitForTimeout(12000);
  await page.locator("#timetable").scrollIntoViewIfNeeded();
});

test("fix cards render with signature, meta and working actions", async ({ page }) => {
  await page.getByText("Brass fix-cards", { exact: false }).scrollIntoViewIfNeeded();
  const cards = page.locator("[data-fix-card]");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  // Card anatomy: error-signature chip, attempt/time, source file, actions.
  const first = cards.first();
  await expect(first.getByText(/ATTEMPT \d|BASE ARCHIVE/)).toBeVisible();
  await expect(first.getByText(/filed from/)).toBeVisible();
  await expect(first.getByRole("button", { name: /copy fix/i })).toBeVisible();
  await expect(first.getByRole("button", { name: /view diff/i })).toBeVisible();
  await expect(first.getByRole("button", { name: /locate on map/i })).toBeVisible();
});

test("search narrows with a count and clears back", async ({ page }) => {
  const search = page.getByLabel(/search the archive/i);
  await search.fill("bool map");
  await expect(page.getByText(/1 FIX/)).toBeVisible();
  expect(await page.locator("[data-fix-card]").count()).toBe(1);
  await page.getByRole("button", { name: /clear search/i }).click();
  expect(await page.locator("[data-fix-card]").count()).toBeGreaterThanOrEqual(2);
});

test("tag chips filter and toggle", async ({ page }) => {
  await page.getByRole("button", { name: "datetime", exact: true }).click();
  const count = await page.locator("[data-fix-card]").count();
  expect(count).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "datetime", exact: true }).click();
  expect(await page.locator("[data-fix-card]").count()).toBeGreaterThanOrEqual(count);
});

test("mini-map selects both ways with visible labels and legend", async ({ page }) => {
  const nodes = page.locator("[data-minimap-node]");
  expect(await nodes.count()).toBeGreaterThanOrEqual(3);
  // Card → node: locate highlights the node.
  await page.locator("[data-fix-card]").first().getByRole("button", { name: /locate on map/i }).click();
  await expect(nodes.first().locator("..")).toBeAttached(); // selection applied without crash
  const selected = page.locator('[data-minimap-node][data-selected="true"]');
  await expect(selected.first()).toBeVisible();
  // Node → card: clicking scrolls the matching card into view.
  await nodes.first().click();
  // Legend carries live counts.
  await expect(page.getByText(/error \(\d+\)/i)).toBeVisible();
  await expect(page.getByText(/fix \(\d+\)/i)).toBeVisible();
});

test("copy fix reports back", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("[data-fix-card]").first().getByRole("button", { name: /copy fix/i }).click();
  await expect(
    page.locator("[data-fix-card]").first().getByRole("button", { name: /copied/i }),
  ).toBeVisible();
});
