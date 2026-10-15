import { MotionConfig } from "framer-motion";
import { useEffect } from "react";
import { ArchiveCards } from "./components/ArchiveCards";
import { CarriageMagnifier } from "./components/CarriageMagnifier";
import { CodePoster } from "./components/CodePoster";
import { DepartureBoard } from "./components/DepartureBoard";
import { DepotTerminal } from "./components/DepotTerminal";
import { GateHero } from "./components/GateHero";
import { PaperSection } from "./components/PaperSection";
import { PlatformSheet } from "./components/PlatformSheet";
import { SrLive, ServiceTicker } from "./components/ServiceTicker";
import { TicketMachine } from "./components/TicketMachine";
import { TransitMap } from "./components/TransitMap";
import { useTransit } from "./store";

export default function App() {
  const setMobile = useTransit((s) => s.setMobile);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setMobile]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="street-grid min-h-screen bg-[#f6f3ea] pb-16 text-[#141210]">
        <a
          href="#livemap"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[#141210] focus:px-4 focus:py-2 focus:text-[#f6f3ea]"
        >
          Skip to live map
        </a>
        <SrLive />
        <GateHero />
        <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
          <section id="livemap" aria-label="Live transit map" className="relative overflow-hidden rounded-2xl border-[3px] border-[#141210] bg-[#fffdf6] shadow-[6px_6px_0_#141210]">
            <DepartureBoard />
            <div className="pt-14">
              <TransitMap />
            </div>
            <div className="border-t-2 border-dashed border-[#141210]/20 px-4 py-2">
              <p className="font-board text-[11px] text-[#6b6455]">
                Drag to pan · Ctrl-scroll or pinch to zoom · tap stations &amp; carriages · arrow keys work when the map is focused
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Track state legend">
                {[
                  { label: "Idle", style: { borderTop: "4px solid #141210" } },
                  { label: "Repair active", style: { borderTop: "4px dotted #f59e0b" } },
                  { label: "Completed", style: { borderTop: "4px solid #16a34a" } },
                  { label: "Failing", style: { borderTop: "4px dashed #e3342f" } },
                ].map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5 font-board text-[10px] font-bold tracking-widest text-[#57534e]">
                    <span aria-hidden className="inline-block w-7" style={s.style} />
                    {s.label.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <PaperSection
            id="timetable"
            kicker="Code Junction · printed timetable"
            title="Timetable poster & work orders"
            blurb="The exact Python the model posted, versioned per attempt — with the red/green work-order diff the repair crew fitted."
          >
            <CodePoster />
          </PaperSection>

          <PaperSection
            kicker="Sandbox Terminal · glass depot"
            title="Live depot terminal"
            blurb="The terminal glows while clean() runs on a quarantined copy. Filter the stream or freeze it mid-thought."
          >
            <DepotTerminal />
          </PaperSection>

          <PaperSection
            kicker="Archive Terminus · Memory Line"
            title="Brass fix-cards & incident mini-map"
            blurb="Every repair is stamped, filed by error signature, and dotted to similar past incidents."
          >
            <ArchiveCards />
          </PaperSection>

          <TicketMachine />
        </main>
        <footer className="px-4 py-8 text-center font-board text-xs text-[#6b6455] sm:px-6">
          <p>
            PIPELINEFORGE TRANSIT AUTHORITY · simulated frontend — plug <span className="font-bold text-[#b91c1c]">/simulation</span> into
            the real engine API when ready · mind the gap
          </p>
        </footer>
        <PlatformSheet />
        <CarriageMagnifier />
        <ServiceTicker />
      </div>
    </MotionConfig>
  );
}
