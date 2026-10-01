import { expect, test } from "@playwright/test";

/**
 * P7: mobile platform sheet must move keyboard focus into the dialog.
 * The desktop sheet focuses itself on open (ref + tabIndex); the mobile
 * bottom-sheet branch has neither, so keyboard/screen-reader users are
 * stranded on the page behind the modal.
 */
test("mobile station sheet takes focus on open", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /load messy sample/i }).click();
  await page.locator('g[aria-label*="Schema Square"]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const focusedInside = await dialog.evaluate((el) =>
    el.contains(document.activeElement),
  );
  expect(focusedInside).toBe(true);
});
