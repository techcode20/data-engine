import { expect, test, type Page } from "@playwright/test";

interface LabelBox {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding boxes of every tagged map label, in SVG user units.
 *  Accounts for the viewport's pan/zoom transform (parsed off the inner
 *  <g>): without it, boxes come back in a translated frame and containment
 *  checks against the viewBox are meaningless. Pairwise overlap is
 *  translation/scale-invariant, so it was valid either way. */
async function labelBoxes(page: Page): Promise<{ boxes: LabelBox[]; vb: { w: number; h: number } }> {
  return page.evaluate(() => {
    const svg = document.querySelector("#livemap svg");
    if (!svg) return { boxes: [], vb: { w: 0, h: 0 } };
    const [,, w, h] = (svg.getAttribute("viewBox") ?? "0 0 0 0").split(" ").map(Number);
    const g = svg.querySelector(":scope > g");
    let vx = 0;
    let vy = 0;
    let vk = 1;
    const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g?.getAttribute("transform") ?? "");
    if (m) {
      vx = Number(m[1]);
      vy = Number(m[2]);
      vk = Number(m[3]) || 1;
    }
    const s = svg.getBoundingClientRect();
    // meet-letterboxing: uniform scale + centered content offset.
    const scale = Math.min(s.width / (w || 1), s.height / (h || 1)) || 1;
    const ox = s.x + (s.width - w * scale) / 2;
    const oy = s.y + (s.height - h * scale) / 2;
    const els = [...svg.querySelectorAll("[data-map-label]")];
    const boxes = els.map((el) => {
      const r = (el as SVGGraphicsElement).getBoundingClientRect();
      return {
        label: el.getAttribute("data-map-label") ?? "?",
        x: ((r.x - ox) / scale - vx) / vk,
        y: ((r.y - oy) / scale - vy) / vk,
        w: r.width / scale / vk,
        h: r.height / scale / vk,
      };
    });
    return { boxes, vb: { w, h } };
  });
}

/** No two labels may share area, and all must sit inside the viewBox.
 *  2px tolerance: stacked text lines (name over microcopy) legitimately
 *  graze by a descender pixel — that is leading, not a collision. The
 *  animated train is deliberately untagged: it moves, so a static overlap
 *  rule cannot apply to it. */
export function assertNoLabelOverlap(boxes: LabelBox[], vb: { w: number; h: number }) {
  const EPS = 2;
  expect(boxes.length, "no tagged labels found on the map").toBeGreaterThan(5);
  for (const b of boxes) {
    expect(b.x, `${b.label} off left edge`).toBeGreaterThanOrEqual(-EPS);
    expect(b.y, `${b.label} off top edge`).toBeGreaterThanOrEqual(-EPS);
    expect(b.x + b.w, `${b.label} off right edge`).toBeLessThanOrEqual(vb.w + EPS);
    expect(b.y + b.h, `${b.label} off bottom edge`).toBeLessThanOrEqual(vb.h + EPS);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(
        ox <= EPS || oy <= EPS,
        `overlap: "${a.label}" × "${b.label}" (${ox.toFixed(1)}×${oy.toFixed(1)}px)`,
      ).toBe(true);
    }
  }
}

for (const width of [1920, 1280, 390]) {
  test(`map labels never overlap @${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await page.getByText("Load messy sample dataset").click();
    await page.getByText("DEPART", { exact: true }).click();
    // Mid-run: badges, checks and turnstile states are all populated.
    await page.waitForTimeout(12000);
    const { boxes, vb } = await labelBoxes(page);
    assertNoLabelOverlap(boxes, vb);
    await page
      .locator("#livemap")
      .screenshot({ path: `e2e/screenshots/map-${width}.png` });
  });
}
