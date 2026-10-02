import type { ReactNode } from "react";

interface Props {
  kicker: string;
  title: string;
  blurb: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}

/** Paper ticket-card section shell. */
export function PaperSection({ kicker, title, blurb, action, children, id }: Props) {
  return (
    <section
      id={id}
      aria-label={title}
      className="rounded-2xl border-[3px] border-[#141210] bg-[#fffdf6] p-5 shadow-[6px_6px_0_#141210] sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-board text-[11px] font-bold uppercase tracking-[0.25em] text-[#b91c1c]">{kicker}</p>
          <h2 className="mt-1 text-xl font-bold sm:text-2xl">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#3f3a30]">{blurb}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
