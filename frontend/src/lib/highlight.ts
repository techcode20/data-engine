import Prism from "prismjs";
import "prismjs/components/prism-python";

/** Highlight Python source to HTML (Prism tomorrow theme is imported in index.css). */
export function highlightPython(code: string): string {
  return Prism.highlight(code, Prism.languages.python, "python");
}

/** Escape then highlight a single line — keeps diff rendering safe. */
export function highlightLine(line: string): string {
  if (!line.trim()) return "&nbsp;";
  return highlightPython(line);
}
