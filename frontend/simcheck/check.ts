/** Headless simulation check: runs the REAL TransitEngine event stream in Node
 *  (no DOM — motion is skipped, state events still fire) at 200x and asserts
 *  the narrative invariants. Run: npm run simcheck
 */
import { legFractions, TransitEngine } from "../src/simulation/engine";
import { ROUTES, routePoints } from "../src/transit/mapConfig";
import { snapshotForAttempt, validateScript } from "../src/simulation/script";
import type { EngineEvent } from "../src/simulation/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

async function main() {
  console.log("simcheck: script structure");
  check("validateScript() clean", validateScript().length === 0, validateScript().join("; "));

  console.log("simcheck: route geometry");
  for (const key of ["attempt1", "attempt2", "attempt3"] as const) {
    const pts = routePoints(ROUTES[key], false);
    const fracs = legFractions(pts);
    check(`${key} fractions end at 1`, Math.abs(fracs[fracs.length - 1] - 1) < 1e-9);
    check(`${key} fractions monotonic`, fracs.every((f, i) => i === 0 || f >= fracs[i - 1]));
    const mpts = routePoints(ROUTES[key], true);
    check(`${key} mobile route valid`, mpts.length === pts.length);
  }

  console.log("simcheck: snapshots");
  const s2 = snapshotForAttempt(2);
  check("snap2 code v2", s2.codeVersion === 2);
  check("snap2 keeps fix #1", s2.memNodes.some((n) => n.id === "err-neg-age"));
  check("snap2 reroute off", s2.rerouteOn === false);
  check("snap2 carriages from attempt 1", JSON.stringify(s2.carriages) === JSON.stringify(["dirty", "rejected", "dirty", "rejected"]));
  const s3 = snapshotForAttempt(3);
  check("snap3 reroute on", s3.rerouteOn === true);
  check("snap3 score 74", s3.score === 74);

  console.log("simcheck: full headless run (200x)");
  const eng = new TransitEngine();
  const seen: EngineEvent[] = [];
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("run timed out")), 30000);
    eng.onEvent((e) => {
      seen.push(e);
      if (e.type === "done") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  eng.setTestTimeScale(200);
  eng.start();
  await done;

  const ofType = (t: EngineEvent["type"]) => seen.filter((e) => e.type === t);
  const attempts = ofType("attempt").map((e) => (e as { n: number }).n);
  check("attempt markers 1,2,3 in order", JSON.stringify(attempts) === JSON.stringify([1, 2, 3]), JSON.stringify(attempts));

  const firstIdx = (pred: (e: EngineEvent) => boolean) => seen.findIndex(pred);
  const iRunning = firstIdx(
    (e) => e.type === "stage" && (e as { id: string }).id === "validation" && (e as { status: string }).status === "running",
  );
  const iChecks = firstIdx((e) => e.type === "checks");
  const iFailed = firstIdx(
    (e) => e.type === "stage" && (e as { id: string }).id === "validation" && (e as { status: string }).status === "failed",
  );
  check(
    "narrative interleaves (running → checks → failed)",
    iRunning !== -1 && iRunning < iChecks && iChecks < iFailed,
    `running@${iRunning} checks@${iChecks} failed@${iFailed}`,
  );
  const valStatuses = seen
    .filter((e) => e.type === "stage")
    .filter((e) => (e as { id: string }).id === "validation")
    .map((e) => (e as { status: string }).status)
    .filter((s) => s !== "running");
  check(
    "validation failed, failed, passed",
    JSON.stringify(valStatuses) === JSON.stringify(["failed", "failed", "passed"]),
    JSON.stringify(valStatuses),
  );

  const codes = ofType("code").map((e) => (e as { version: number }).version);
  check("code versions 1,2,3", JSON.stringify(codes) === JSON.stringify([1, 2, 3]), JSON.stringify(codes));

  const scores = ofType("score").map((e) => (e as { value: number }).value);
  check("scores ascend 36,74,97", JSON.stringify(scores) === JSON.stringify([36, 74, 97]), JSON.stringify(scores));

  const cars = ofType("carriages").pop() as { states: string[] } | undefined;
  check(
    "final carriages clean/rejected/partial/rejected",
    JSON.stringify(cars?.states) === JSON.stringify(["clean", "rejected", "partial", "rejected"]),
    JSON.stringify(cars?.states),
  );

  const reroutes = ofType("reroute").filter((e) => (e as { on: boolean }).on);
  check("reroute fired exactly once", reroutes.length === 1, `got ${reroutes.length}`);

  const boards = ofType("board").map((e) => (e as { status: string }).status);
  check("final board ALL SERVICES RESTORED", boards[boards.length - 1] === "ALL SERVICES RESTORED");

  check("tickets fired", ofType("tickets").length === 1);
  check("3 alerts fired", ofType("alert").length === 3, `got ${ofType("alert").length}`);
  check("done is last", seen[seen.length - 1].type === "done");
  check("event volume sane (>80)", seen.length > 80, `got ${seen.length}`);

  const memAdds = ofType("memory-add").length;
  check("3 memory-add batches", memAdds === 3, `got ${memAdds}`);

  if (failures > 0) {
    console.error(`simcheck: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("simcheck: all green");
}

main().catch((err) => {
  console.error(`simcheck ERROR: ${err?.message ?? err}`);
  process.exit(1);
});
