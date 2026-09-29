import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  kicker: string;
  title: string;
  blurb: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}

/** Consistent glass section shell with staggered reveal. */
export function Section({ kicker, title, blurb, action, children, id }: Props) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ type: "spring", stiffness: 90, damping: 18 }}
      className="glass rounded-2xl p-5 sm:p-7"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-code text-[11px] uppercase tracking-[0.25em] text-[#22d3ee]">{kicker}</p>
          <h2 className="mt-1 text-xl font-bold sm:text-2xl">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#9aa3b5]">{blurb}</p>
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}
