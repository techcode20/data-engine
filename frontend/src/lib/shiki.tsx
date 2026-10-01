import { useEffect, useState } from "react";
import type { Highlighter } from "shiki";

let cached: Highlighter | null = null;

export function usePythonHighlight(code: string): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Dynamic import: shiki core stays out of the main bundle until needed.
        const { createHighlighter } = await import("shiki");
        if (!cached) {
          cached = await createHighlighter({ themes: ["github-light"], langs: ["python"] });
        }
        if (!cancelled) setHtml(cached.codeToHtml(code, { lang: "python", theme: "github-light" }));
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);
  return html;
}

/** Plain-text fallback with line numbers when Shiki is unavailable. */
export function PlainCode({ code }: { code: string }) {
  return (
    <pre className="font-board overflow-x-auto p-3 text-[12px] leading-[1.7]">
      <code>
        {code.split("\n").map((line, i) => (
          <span key={i} className="block">
            <span className="mr-4 inline-block w-7 select-none text-right text-[#a8a091]">{i + 1}</span>
            <span>{line || " "}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}
