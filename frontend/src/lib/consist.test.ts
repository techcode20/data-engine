import { expect, test } from "vitest";
import { groupCars } from "./consist";
import type { BatchRow } from "../simulation/types";

const row = (fate: "kept" | "dropped"): BatchRow =>
  fate === "kept"
    ? { values: ["1"], cleaned: ["1"], fate, reason: "r" }
    : { values: ["x"], fate, reason: "r" };

test("empty rows pass states through 1:1 (scripted path)", () => {
  expect(groupCars(["dirty", "dirty", "dirty", "dirty"], [])).toHaveLength(4);
});

test("eight rows group into four cars with worst-wins states", () => {
  const states = ["clean", "clean", "clean", "rejected", "rejected", "rejected", "clean", "clean"] as const;
  const rows = states.map((f) => row(f === "clean" ? "kept" : "dropped"));
  const cars = groupCars([...states], rows);
  expect(cars).toHaveLength(4);
  expect(cars.map((c) => c.state)).toEqual(["clean", "partial", "rejected", "clean"]);
  expect(cars.map((c) => c.rows.length)).toEqual([2, 2, 2, 2]);
});

test("odd counts pack the remainder into the last car", () => {
  const cars = groupCars(
    ["clean", "clean", "clean", "clean", "rejected"],
    ["clean", "clean", "clean", "clean", "rejected"].map((f) =>
      row(f === "clean" ? "kept" : "dropped"),
    ),
  );
  expect(cars).toHaveLength(3);
  expect(cars[2].state).toBe("rejected");
  expect(cars[2].rows).toHaveLength(1);
});
