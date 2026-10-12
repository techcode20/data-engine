import { expect, test } from "vitest";
import { layoutGraph, seededRandom, textSimilarity } from "./graph";

test("seeded PRNG is deterministic", () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  expect(Array.from({ length: 5 }, () => a())).toEqual(
    Array.from({ length: 5 }, () => b()),
  );
  expect(seededRandom(8)()).not.toBe(seededRandom(7)());
});

test("text similarity is 1 for identical, 0 for disjoint", () => {
  expect(textSimilarity("bool map", "bool map")).toBe(1);
  expect(textSimilarity("bool map", "currency cleanup")).toBe(0);
  const mid = textSimilarity("bool map astype", "bool map dropna");
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(1);
});

test("layout is deterministic and fills the panel", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const links: Array<readonly [string, string]> = [["a", "b"], ["b", "c"], ["d", "e"]];
  const once = layoutGraph(ids, links, 300, 180);
  const twice = layoutGraph(ids, links, 300, 180);
  expect(once).toEqual(twice);
  for (const p of once) {
    expect(p.x).toBeGreaterThanOrEqual(18);
    expect(p.x).toBeLessThanOrEqual(300 - 18);
    expect(p.y).toBeGreaterThanOrEqual(18);
    expect(p.y).toBeLessThanOrEqual(180 - 18);
  }
  const xs = once.map((p) => p.x);
  const ys = once.map((p) => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40);
});

test("empty input lays out nothing", () => {
  expect(layoutGraph([], [], 300, 180)).toEqual([]);
});
