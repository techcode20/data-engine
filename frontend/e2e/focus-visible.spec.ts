import { expect, test } from "@playwright/test";

/**
 * P8: keyboard focus must be VISIBLE. No :focus-visible rule exists in the
 * served CSS, and the computed outline-style on a focused control is "none"
 * (probed) — keyboard users cannot tell where they are.
 */
test("focused controls show a visible focus indicator", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /load messy sample/i }).click();

  // 1. Stylesheet level: some :focus-visible rule must exist.
  const cssTexts: string[] = await page.evaluate(async () => {
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      try {
        const href = (sheet as CSSStyleSheet).href;
        if (!href) continue;
        const res = await fetch(href);
        out.push(await res.text());
      } catch {
        /* cross-origin (fonts) — skip */
      }
    }
    const inline = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "");
    return [...out, ...inline];
  });
  expect(
    cssTexts.some((t) => t.includes(":focus-visible")),
    "no :focus-visible rule in served CSS",
  ).toBe(true);

  // 2. Computed style level: focusing DEPART must produce a visible cue.
  const depart = page.getByRole("button", { name: "DEPART" });
  await depart.focus();
  const style = await depart.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  });
  expect(style.outlineStyle, "focus ring has no style").not.toBe("none");
});
