/** Red/green work-order ticket: what the model patched between versions. */
export function CodeDiff({ oldCode, newCode, from, to }: { oldCode: string; newCode: string; from: number; to: number }) {
  const hunks = diff(oldCode, newCode);
  return (
    <div className="overflow-hidden rounded-xl border-[3px] border-[#141210] bg-[#fffdf6] shadow-[5px_5px_0_#141210]">
      <p className="border-b-[3px] border-[#141210] bg-[#e3342f] px-3 py-1.5 font-board text-[11px] font-bold tracking-widest text-white">
        WORK ORDER · v{from} → v{to} · REPAIR DEPOT
      </p>
      <pre className="font-board max-h-[380px] overflow-auto p-3 text-[12px] leading-[1.7]">
        <code>
          {hunks.map((h, i) => (
            <span key={i} className={`block rounded px-1 ${h.kind === "add" ? "bg-[#16a34a]/15" : h.kind === "del" ? "bg-[#e3342f]/10" : ""}`}>
              <span className="mr-3 inline-block w-14 select-none text-right text-[#a8a091]">
                {h.oldNo ?? ""} {h.newNo ?? ""}
              </span>
              <span className={`mr-2 select-none font-bold ${h.kind === "add" ? "text-[#16a34a]" : h.kind === "del" ? "text-[#e3342f]" : "text-[#a8a091]"}`}>
                {h.kind === "add" ? "+" : h.kind === "del" ? "−" : " "}
              </span>
              <span>{h.text || " "}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

interface Hunk {
  kind: "same" | "add" | "del";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

function diff(oldText: string, newText: string): Hunk[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], oldNo: oldNo++, newNo: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i], oldNo: oldNo++, newNo: null });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], oldNo: null, newNo: newNo++ });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++], oldNo: oldNo++, newNo: null });
  while (j < m) out.push({ kind: "add", text: b[j++], oldNo: null, newNo: newNo++ });
  return out;
}
