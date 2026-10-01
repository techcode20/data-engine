import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { whistle } from "../lib/sound";
import { useTransit } from "../store";
import type { Speed } from "../simulation/types";
import { TimelineScrubber } from "./TimelineScrubber";

/** Ticket gate: upload → big DEPART button, whistle, 3-position speed lever. */
export function DepartControls() {
  const file = useTransit((s) => s.file);
  const phase = useTransit((s) => s.phase);
  const paused = useTransit((s) => s.paused);
  const togglePause = useTransit((s) => s.togglePause);
  const reset = useTransit((s) => s.reset);
  const depart = useTransit((s) => s.depart);
  const speed = useTransit((s) => s.speed);
  const setSpeed = useTransit((s) => s.setSpeed);
  const sound = useTransit((s) => s.sound);
  const setSound = useTransit((s) => s.setSound);

  const go = () => {
    if (sound) whistle();
    depart();
  };

  return (
    <div className="mt-4 rounded-2xl border-[3px] border-[#141210] bg-[#fffdf6] p-4 shadow-[6px_6px_0_#141210]">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={go}
          disabled={!file || phase === "running"}
          className="rounded-xl border-[3px] border-[#141210] bg-[#e3342f] px-8 py-3 text-lg font-bold tracking-wide text-white shadow-[4px_4px_0_#141210] transition hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase === "running" ? "● RUNNING" : "DEPART"}
        </button>
        {phase !== "idle" && (
          <>
            <button
              onClick={togglePause}
              aria-label={paused ? "Resume" : "Pause"}
              className="rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] p-2.5 shadow-[3px_3px_0_#141210] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              {paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
            <button
              onClick={reset}
              aria-label="Reset simulation"
              className="inline-flex items-center gap-1.5 rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] px-3.5 py-2 text-sm font-bold shadow-[3px_3px_0_#141210] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              <RotateCcw size={15} /> Reset
            </button>
          </>
        )}
        <div className="flex items-center gap-2" role="group" aria-label="Speed lever">
          <span className="font-board text-[10px] tracking-widest text-[#6b6455]">LEVER</span>
          <div className="flex rounded-xl border-[3px] border-[#141210] bg-[#f6f3ea] p-1">
            {(["Local", "Express", "Rapid"] as const).map((label, i) => {
              const v = [1, 2, 4][i] as Speed;
              const on = speed === v;
              return (
                <button
                  key={label}
                  onClick={() => setSpeed(v)}
                  aria-pressed={on}
                  title={`${v}x speed`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${on ? "bg-[#141210] text-[#f6f3ea]" : "hover:bg-[#141210]/5"}`}
                >
                  {label}
                  <span className="font-board ml-1 text-[10px] opacity-70">{v}x</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => setSound(!sound)}
          aria-pressed={sound}
          aria-label={sound ? "Mute whistle" : "Enable whistle"}
          title="Conductor's whistle"
          className={`rounded-xl border-[3px] border-[#141210] p-2.5 shadow-[3px_3px_0_#141210] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none ${sound ? "bg-[#f59e0b]" : "bg-[#fffdf6]"}`}
        >
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </div>
      <div className="mt-3">
        <TimelineScrubber />
      </div>
      {!file && (
        <p className="mt-2 text-xs italic text-[#6b6455]">Punch a ticket above — load the sample or drop a file — then press DEPART.</p>
      )}
    </div>
  );
}
