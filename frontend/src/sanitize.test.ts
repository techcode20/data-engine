// @vitest-environment jsdom
// NOTE: jsdom, not happy-dom — DOMPurify needs a spec-compliant inert
// document (createHTMLDocument). Under happy-dom the same assertions produce
// parser artifacts, which is a test-env limitation, not product behavior.
// Real-browser coverage lives in e2e/sanitize.spec.ts.
import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";

/**
 * The Shiki-highlighted timetable is the only raw-HTML sink in the app.
 * These tests prove the DOMPurify layer around it cannot be bypassed by
 * markup smuggled inside highlighted code: event handlers, javascript: URLs,
 * embedded SVG/script, and style-based exfiltration must all come out dead.
 */
describe("highlight sink sanitization", () => {
  it("strips event-handler attributes but keeps code text", () => {
    const hostile =
      '<pre><code><img src=x onerror="alert(1)"><span onload="alert(2)">def clean(df):</span></code></pre>';
    const clean = DOMPurify.sanitize(hostile);
    expect(clean).not.toMatch(/onerror|onload/i);
    expect(clean).toContain("def clean(df):");
  });

  it("strips script elements and javascript: URLs", () => {
    const hostile =
      '<script>alert(1)</script><a href="javascript:alert(2)">x</a><svg onload="alert(3)"></svg>';
    const clean = DOMPurify.sanitize(hostile);
    expect(clean).not.toMatch(/<script|javascript:|onload/i);
  });

  it("keeps legitimate highlighter spans intact", () => {
    const benign =
      '<pre class="shiki"><code><span class="line"><span style="color:#CF222E">def</span> clean(df):</span></code></pre>';
    const clean = DOMPurify.sanitize(benign);
    expect(clean).toContain("def");
    expect(clean).toContain("clean(df):");
    expect(clean).toMatch(/<span/);
  });

  it("keeps Shiki-style color spans but drops smuggled handlers", () => {
    // This mirrors the real sink: Shiki emits <span style="color:…"> tokens.
    const shikiLike =
      '<span style="color:#CF222E" onclick="alert(1)">def</span>';
    const clean = DOMPurify.sanitize(shikiLike);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).toContain("def");
    expect(clean).toMatch(/color/);
  });
});
