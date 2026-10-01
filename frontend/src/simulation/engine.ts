import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ROUTES, archivePoints, repairLoopPoints, routePoints } from "../transit/mapConfig";
import type { Pt } from "../transit/mapConfig";
import { ATTEMPTS, snapshotForAttempt } from "./script";
import type { AttemptScript, EngineEvent, Speed, StageStatus } from "./types";

gsap.registerPlugin(MotionPathPlugin);

export type { Speed };

/** Leg fractions along a waypoint route (cumulative chord length). */
export function legFractions(pts: Pt[]): number[] {
  const fracs = [0];
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let acc = 0;
  for (const l of lens) {
    acc += l;
    fracs.push(total === 0 ? 1 : acc / total);
  }
  return fracs;
}

type El = SVGGElement | null;

const STAGE_LABEL: Record<string, string> = {
  intake: "Intake Central",
  schema: "Schema Square",
  code: "Code Junction",
  sandbox: "Sandbox Terminal",
  validation: "Validation Gate",
  repair: "Repair Depot",
  archive: "Archive Terminus",
};

const BASE_IDS = new Set(["ds-ridership", "err-bool", "fix-boolmap", "err-dtype", "fix-astype"]);

export class TransitEngine {
  private emit: (e: EngineEvent) => void = () => {};
  private tls: Array<gsap.core.Timeline | undefined> = [];
  private speed: Speed = 1;
  private testScale: number | null = null;
  private reduced = false;
  private mobile = false;
  private playingAttempt = 0;
  trainPos = { x: 0, y: 0 };

  trainEl: El = null;
  crewEl: El = null;
  shuntEl: El = null;

  onEvent(cb: (e: EngineEvent) => void) {
    this.emit = cb;
  }
  setMobile(m: boolean) {
    this.mobile = m;
  }
  setReducedMotion(r: boolean) {
    this.reduced = r;
  }
  setSpeed(s: Speed) {
    this.speed = s;
    for (const tl of this.tls) tl?.timeScale(this.effectiveScale());
  }

  /** Test hook: run timelines at arbitrary scale (headless simcheck). */
  setTestTimeScale(x: number | null) {
    this.testScale = x;
    for (const tl of this.tls) tl?.timeScale(this.effectiveScale());
  }

  private effectiveScale(): number {
    return this.testScale ?? this.speed;
  }
  pause() {
    this.tls[this.playingAttempt - 1]?.pause();
  }
  resume() {
    this.tls[this.playingAttempt - 1]?.resume();
  }
  stop() {
    for (const tl of this.tls) tl?.kill();
    this.tls = [];
    this.playingAttempt = 0;
  }

  start() {
    this.stop();
    this.playAttempt(1);
  }

  playAttempt(n: number) {
    this.tls[n - 1]?.kill();
    this.resolveEls();
    this.snapTrainToStart();
    const tl = this.buildAttempt(n);
    this.tls[n - 1] = tl;
    this.playingAttempt = n;
    tl.timeScale(this.effectiveScale()).play();
  }

  /** Jump the map back to the start of attempt N, then play it. */
  replayAttempt(n: number) {
    this.stop();
    const snap = snapshotForAttempt(n);
    this.emit({ type: "stages-reset" });
    this.emit({ type: "attempt", n });
    this.emit({ type: "code", version: snap.codeVersion });
    this.emit({ type: "checks", items: [] });
    this.emit({ type: "score", value: snap.score });
    this.emit({ type: "error", text: null });
    this.emit({ type: "disruption", on: false });
    this.emit({ type: "reroute", on: snap.rerouteOn });
    this.emit({ type: "crew", visible: false });
    this.emit({ type: "carriages", states: [...snap.carriages] });
    this.emit({
      type: "memory-add",
      nodes: snap.memNodes.filter((m) => !BASE_IDS.has(m.id)),
      links: snap.memLinks,
    });
    this.emit({ type: "board", next: "Intake Central", status: "ON TIME" });
    this.emit({ type: "log", level: "INFO", text: `── rewound to attempt ${n} ──` });
    this.snapTrainToStart();
    this.playAttempt(n);
  }

  durationOf(n: number): number {
    return APPROX_DUR[n] ?? 0;
  }

  private resolveEls() {
    this.trainEl = this.el("pf-train");
    this.crewEl = this.el("pf-crew");
    this.shuntEl = this.el("pf-shunt");
  }

  private el(id: string): El {
    if (typeof document === "undefined") return null;
    return document.getElementById(id) as unknown as El;
  }

  private pathEl(id: string): SVGPathElement | null {
    if (typeof document === "undefined") return null;
    return document.getElementById(id) as unknown as SVGPathElement | null;
  }

  private snapTrainToStart() {
    if (!this.trainEl) return;
    const route = this.pathEl("pf-route-main");
    if (!route || typeof (route as SVGPathElement).getPointAtLength !== "function") return;
    try {
      const pt = (route as SVGPathElement).getPointAtLength(0);
      gsap.set(this.trainEl, { x: pt.x, y: pt.y });
      this.trainPos = { x: pt.x, y: pt.y };
    } catch {
      /* headless — no DOM */
    }
  }

  private ride(
    tl: gsap.core.Timeline,
    target: El,
    path: SVGPathElement | null,
    from: number,
    to: number,
    duration: number,
    trackPos: boolean,
  ) {
    if (!target || !path) return;
    tl.to(target, {
      duration: this.reduced ? 0.01 : duration,
      ease: "power1.inOut",
      motionPath: { path, align: path, alignOrigin: [0.5, 0.5], start: from, end: to },
      onUpdate: trackPos
        ? () => {
            this.trainPos = {
              x: Number(gsap.getProperty(target, "x")),
              y: Number(gsap.getProperty(target, "y")),
            };
          }
        : undefined,
    });
  }

  private buildAttempt(n: number): gsap.core.Timeline {
    const attempt = ATTEMPTS[n - 1];
    const tl = gsap.timeline({ paused: true });
    // NOTE: gsap .call() defaults to the END of the timeline. Every state
    // event must be pinned at the current end, otherwise the whole narrative
    // (statuses, logs, checks) fires in one burst when the attempt finishes.
    const call = (e: EngineEvent) => {
      tl.call(
        () => this.emit(e),
        undefined,
        tl.duration(),
      );
    };

    call({ type: "attempt", n });
    call({ type: "code", version: attempt.codeVersion });
    call({ type: "board", next: "Intake Central", status: "ON TIME" });

    const mainPts = routePoints(ROUTES[`attempt${n}` as keyof typeof ROUTES], this.mobile);
    const fracs = legFractions(mainPts);
    const mainPath = this.pathEl("pf-route-main");
    const legDur = n === 1 ? [1.1, 1.1, 1.2, 1.2] : [0.9, 0.9, 1.0, 1.0];
    const stageForLeg = ["intake", "schema", "code", "sandbox"] as const;
    const dwell = 0.45;

    stageForLeg.forEach((stage, i) => {
      call({ type: "stage", id: stage, status: "running" });
      call({ type: "board", next: STAGE_LABEL[stage], status: "ON TIME" });
      this.ride(tl, this.trainEl, mainPath, fracs[i], fracs[i + 1], legDur[i], true);
      call({ type: "stage", id: stage, status: "passed", durationMs: Math.round(legDur[i] * 1000) });
      tl.to({}, { duration: dwell });
    });

    call({ type: "stage", id: "validation", status: "running" });
    call({ type: "board", next: "Validation Gate", status: "ON TIME" });
    tl.to({}, { duration: 1.0 });
    call({ type: "checks", items: attempt.checks });
    call({ type: "score", value: attempt.score });

    if (attempt.errorFedBack) {
      call({ type: "stage", id: "validation", status: "failed", durationMs: 1600 });
      call({ type: "error", text: attempt.errorFedBack });
      call({ type: "disruption", on: true, label: attempt.disruption ?? undefined });
      call({ type: "board", next: "Validation Gate", status: "DELAYED" });
      call({ type: "alert", text: attempt.alert });
      call({ type: "carriages", states: [...attempt.carriages] });
      this.shuntCars(tl);
      call({ type: "stage", id: "repair", status: "running" });
      call({ type: "board", next: "Repair Depot", status: "REROUTING" });
      call({ type: "crew", visible: true });
      this.ride(tl, this.crewEl, this.pathEl("pf-route-repair"), 0, 1, n === 1 ? 2.2 : 1.6, false);
      if (n === 2) call({ type: "reroute", on: true });
      call({ type: "crew", visible: false });
      call({ type: "stage", id: "repair", status: "passed", durationMs: 1500 });
      call({ type: "stage", id: "archive", status: "running" });
      tl.to({}, { duration: 0.7 });
      call({ type: "memory-add", nodes: attempt.newMemory.nodes, links: attempt.newMemory.links });
      call({ type: "stage", id: "archive", status: "passed", durationMs: 900 });
    } else {
      call({ type: "stage", id: "validation", status: "passed", durationMs: 1600 });
      call({ type: "error", text: null });
      call({ type: "board", next: "Archive Terminus", status: "ON TIME" });
      call({ type: "carriages", states: [...attempt.carriages] });
      call({ type: "stage", id: "repair", status: "passed", durationMs: 300 });
      call({ type: "stage", id: "archive", status: "running" });
      tl.to({}, { duration: 0.7 });
      call({ type: "memory-add", nodes: attempt.newMemory.nodes, links: attempt.newMemory.links });
      call({ type: "stage", id: "archive", status: "passed", durationMs: 900 });
      this.ride(tl, this.trainEl, this.pathEl("pf-route-archive"), 0, 1, 2.4, true);
      call({ type: "board", next: "Archive Terminus", status: "ALL SERVICES RESTORED" });
      call({ type: "alert", text: attempt.alert });
      call({ type: "tickets" });
    }

    // Distribute the attempt's log lines evenly across the finished timeline.
    const total = tl.duration();
    attempt.logs.forEach((l, i) => {
      tl.call(
        () => this.emit({ type: "log", level: l.level, text: l.text }),
        undefined,
        ((i + 1) / (attempt.logs.length + 1)) * total,
      );
    });

    tl.eventCallback("onComplete", () => {
      if (n < 3) this.playAttempt(n + 1);
      else this.emit({ type: "done" });
    });
    return tl;
  }

  private shuntCars(tl: gsap.core.Timeline) {
    const siding = this.pathEl("pf-route-shunt");
    if (!this.shuntEl || !siding) return;
    tl.set(this.shuntEl, { opacity: 1 });
    this.ride(tl, this.shuntEl, siding, 0, 1, 1.4, false);
  }
}

/** Approximate per-attempt durations (s, 1x) for the scrubber + tests. */
const APPROX_DUR: Record<number, number> = { 1: 11.5, 2: 8.6, 3: 8.4 };

export type { StageStatus };

/** Headless-safe route helpers (re-exported for tests). */
export { archivePoints, repairLoopPoints, routePoints };
export type { AttemptScript };
