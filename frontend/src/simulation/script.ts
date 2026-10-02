import type { AttemptScript, MemoryLink, MemoryNode } from "./types";

export const CODE_V1 = `def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "age",
                "email", "plan", "revenue"]
    df = df.dropna(subset=required)

    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df["customer_id"] = df["customer_id"].astype(int)
    df = df.drop_duplicates(subset=["customer_id"])

    df["signup_date"] = pd.to_datetime(df["signup_date"], errors="coerce")
    df = df.dropna(subset=["signup_date"])

    df["age"] = pd.to_numeric(df["age"], errors="coerce")
    df = df.dropna(subset=["age"])

    df["email"] = df["email"].astype(str).str.lower().str.strip()
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]

    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])

    return df[required].reset_index(drop=True)`;

export const CODE_V2 = `def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "age",
                "email", "plan", "revenue"]
    df = df.dropna(subset=required)
    df["name"] = df["name"].astype(str).str.strip()
    df = df[df["name"] != ""]

    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df = df[df["customer_id"] >= 1]
    df = df.drop_duplicates(subset=["customer_id"])

    # pandas 3 infers ONE datetime format per Series: without
    # format="mixed", valid dates in other formats become NaT.
    df["signup_date"] = pd.to_datetime(
        df["signup_date"], format="mixed", errors="coerce")
    df = df.dropna(subset=["signup_date"])

    df["age"] = pd.to_numeric(df["age"], errors="coerce")
    df = df.dropna(subset=["age"])
    df = df[df["age"] >= 0]

    df["email"] = df["email"].astype(str).str.lower().str.strip()
    email_re = r"^[^@]+@[^@]+\\.[^@]+$"
    df = df[df["email"].str.match(email_re, na=False)]
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]

    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])
    df = df[df["revenue"] >= 0]
    return df[required].reset_index(drop=True)`;

export const CODE_V3 = `def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "age",
                "email", "plan", "revenue"]
    df = df.dropna(subset=required)
    df["name"] = df["name"].astype(str).str.strip()
    df = df[df["name"] != ""]

    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df = df[df["customer_id"] >= 1]
    df = df.drop_duplicates(subset=["customer_id"])

    df["signup_date"] = pd.to_datetime(
        df["signup_date"], format="mixed", errors="coerce")
    df = df.dropna(subset=["signup_date"])

    df["age"] = pd.to_numeric(df["age"], errors="coerce")
    df = df.dropna(subset=["age"])
    df = df[df["age"] >= 0]

    df["email"] = df["email"].astype(str).str.lower().str.strip()
    email_re = r"^[^@]+@[^@]+\\.[^@]+$"
    df = df[df["email"].str.match(email_re, na=False)]
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]

    # "$1,200" is a string, not a number: strip symbols AND commas
    # before converting, or the whole column becomes NaN.
    df["revenue"] = (df["revenue"].astype(str).str.replace("$", "", regex=False)
                     .str.replace(",", "", regex=False).str.strip())
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])
    df = df[df["revenue"] >= 0]

    df = df.astype({
        "customer_id": "int64", "name": "str",
        "signup_date": "datetime64[ns]", "age": "int64",
        "email": "str", "plan": "str", "revenue": "float64",
    })
    return df[required].reset_index(drop=True)`;

export const CODE_VERSIONS = [CODE_V1, CODE_V2, CODE_V3];

/** Opt-in chaos path: attempt 1 stalls in the sandbox instead of failing validation. */
export const CHAOS_ERROR =
  "SandboxTimeout: clean() exceeded its kill budget and was terminated (simulated stall).";
export const CHAOS_DISRUPTION =
  "Signal fault at Sandbox Terminal — the worker stalled past its kill budget.";
export const CHAOS_ALERT =
  "Major delay at Sandbox Terminal: clean() stalled and was terminated by the kill budget. Crew is refitting with a timeout guard — expect timetable v2 shortly.";
export const CHAOS_MEMORY = {
  nodes: [
    {
      id: "err-stall",
      kind: "error",
      label: "sandbox stall",
      detail: "clean() exceeded its kill budget; terminated with no frame to validate",
      dataset: "ridership_customers_messy.csv",
    },
  ],
  links: [{ source: "err-stall", target: "ds-ridership", label: "seen-in" }],
} as { nodes: MemoryNode[]; links: MemoryLink[] };

const BASE_MEMORY: { nodes: MemoryNode[]; links: MemoryLink[] } = {
  nodes: [
    { id: "ds-ridership", kind: "dataset", label: "ridership_customers", detail: "8 rows · 7 cols · CSV", dataset: "ridership_customers_messy.csv" },
    { id: "err-bool", kind: "error", label: "bool vs boolean", detail: "nullable 'boolean' != numpy 'bool' in pandera strict check", dataset: "api.github.com/users" },
    { id: "fix-boolmap", kind: "fix", label: "bool map + astype('bool')", detail: "Map True/False strings then .astype('bool') — never leave as object", dataset: "api.github.com/users" },
    { id: "err-dtype", kind: "error", label: "dtype mismatch", detail: "clean() output dtype != pandera Column dtype", dataset: "sample_data_2.csv" },
    { id: "fix-astype", kind: "fix", label: "terminal astype block", detail: "df.astype({col: int64/float64/bool/str/datetime64[ns]}) as the last step", dataset: "sample_data_2.csv" },
  ],
  links: [
    { source: "err-bool", target: "fix-boolmap", label: "resolved-by" },
    { source: "err-dtype", target: "fix-astype", label: "resolved-by" },
    { source: "fix-astype", target: "ds-ridership", label: "applies-to" },
  ],
};

export function baseMemory() {
  return JSON.parse(JSON.stringify(BASE_MEMORY)) as typeof BASE_MEMORY;
}

export const ATTEMPTS: AttemptScript[] = [
  {
    attempt: 1,
    codeVersion: 1,
    score: 36,
    summary: "First dispatch: naive date parsing, no age floor, no currency handling.",
    checks: [
      { id: "t-dtype", label: "dtype · signup_date is datetime", status: "fail", detail: "4 NaT — mixed formats need format=\"mixed\"" },
      { id: "t-null", label: "null · name present", status: "pass", detail: "empty name dropped" },
      { id: "t-range", label: "range · age ≥ 0, revenue ≥ 0", status: "fail", detail: "age '-4' and 'N/A' slip through; no floor enforced" },
      { id: "t-unique", label: "unique · customer_id", status: "pass", detail: "dup id 202 uncoupled" },
      { id: "t-regex", label: "regex · email valid", status: "fail", detail: "no email check — 'sofia@test' style rows would pass" },
    ],
    errorFedBack:
      "column 'signup_date' dtype failure — 4 NaT after coerce (mixed formats: MM/DD/YYYY, DD-Mon-YYYY, 'Feb 2024'). column 'age' contains negative values (-4) and 'N/A'.",
    disruption: "Signal fault at Validation Gate — mixed date formats in 'signup_date', negative 'age'.",
    alert: "Signal fault at Validation Gate: column 'signup_date' has mixed date formats and column 'age' contains negative values. Expect delays of 1 attempt. Dirty carriages held at the gate.",
    logs: [
      { level: "INFO", text: "ticket gate: ridership_customers_messy.csv → 8 rows × 7 cols, 4 carriages coupled" },
      { level: "INFO", text: "Schema Square: 7 type labels stamped (int×2 float×1 bool×0 datetime×1 str×3)" },
      { level: "INFO", text: "Code Junction: timetable v1 posted (27 lines)" },
      { level: "INFO", text: "Sandbox Terminal: clean() executed in 0.41s — no exception, depot lights green" },
      { level: "ERROR", text: "Validation Gate: TURNSTILES RED — dtype, range, regex fail (3 of 5)" },
      { level: "WARN", text: "service held: 2 dirty carriages uncoupled onto REJECTED siding" },
      { level: "FIX", text: "repair crew dispatched along Repair Line with work-order v2" },
    ],
    newMemory: {
      nodes: [
        { id: "err-neg-age", kind: "error", label: "negative age", detail: "age '-4' and 'N/A' pass a typeless column", dataset: "ridership_customers_messy.csv" },
      ],
      links: [{ source: "err-neg-age", target: "ds-ridership", label: "seen-in" }],
    },
    carriages: ["dirty", "rejected", "dirty", "rejected"],
  },
  {
    attempt: 2,
    codeVersion: 2,
    score: 74,
    summary: "Dates parsed, age floored — but '$1,200' currency strings survive.",
    checks: [
      { id: "t-dtype", label: "dtype · signup_date is datetime", status: "pass", detail: "format=\"mixed\" parses all 4 spellings" },
      { id: "t-null", label: "null · name present", status: "pass", detail: "clean" },
      { id: "t-range", label: "range · age ≥ 0, revenue ≥ 0", status: "fail", detail: "'$1,200' is a string — pd.to_numeric yields NaN, Margaret's row lost" },
      { id: "t-unique", label: "unique · customer_id", status: "pass", detail: "clean" },
      { id: "t-regex", label: "regex · email valid", status: "pass", detail: "TLD enforced" },
    ],
    errorFedBack:
      "column 'revenue' failure — '$1,200' never converted: strip '$' AND ',' before pd.to_numeric, or valid rows silently drop.",
    disruption: "Signal fault at Validation Gate — currency strings still in 'revenue'.",
    alert: "Minor delay at Validation Gate: '$1,200' currency strings still in 'revenue'. Crew refitting the patch — expect a short delay of 1 attempt.",
    logs: [
      { level: "INFO", text: "re-dispatch: train recoupled, timetable v2 posted (age floor + mixed dates)" },
      { level: "INFO", text: "Sandbox Terminal: clean() executed in 0.39s — no exception" },
      { level: "WARN", text: "Validation Gate: 4 of 5 turnstiles green — revenue turnstile RED" },
      { level: "ERROR", text: "diagnosis: '$1,200' → NaN under bare to_numeric; comma never stripped" },
      { level: "FIX", text: "reroute authorised: repair track depot → main line now laid (dashed → solid)" },
      { level: "FIX", text: "work-order v3: strip '$' and ',' before converting revenue" },
    ],
    newMemory: {
      nodes: [
        { id: "fix-mixed", kind: "fix", label: "format='mixed' datetimes", detail: "pd.to_datetime(..., format='mixed') for multi-format columns on pandas 3", dataset: "ridership_customers_messy.csv" },
        { id: "fix-agefloor", kind: "fix", label: "non-negative age guard", detail: "pd.to_numeric + dropna + df[age >= 0] before casting", dataset: "ridership_customers_messy.csv" },
      ],
      links: [
        { source: "err-neg-age", target: "fix-agefloor", label: "resolved-by" },
        { source: "fix-mixed", target: "ds-ridership", label: "applies-to" },
      ],
    },
    carriages: ["dirty", "rejected", "partial", "rejected"],
  },
  {
    attempt: 3,
    codeVersion: 3,
    score: 97,
    summary: "Full pass: 3 rows ride white carriages to Archive Terminus.",
    checks: [
      { id: "t-dtype", label: "dtype · signup_date is datetime", status: "pass", detail: "all formats parsed" },
      { id: "t-null", label: "null · name present", status: "pass", detail: "clean" },
      { id: "t-range", label: "range · age ≥ 0, revenue ≥ 0", status: "pass", detail: "floors enforced, currency parsed" },
      { id: "t-unique", label: "unique · customer_id", status: "pass", detail: "201, 202, 206" },
      { id: "t-regex", label: "regex · email valid", status: "pass", detail: "clean" },
    ],
    errorFedBack: null,
    disruption: null,
    alert: "All services restored. Train arriving at Archive Terminus — 3 clean carriages, 2 shunted to REJECTED siding. Thank you for riding PipelineForge.",
    logs: [
      { level: "INFO", text: "re-dispatch: timetable v3 posted (currency strip + terminal casts)" },
      { level: "INFO", text: "Sandbox Terminal: clean() executed in 0.44s — no exception" },
      { level: "OK", text: "Validation Gate: 5 of 5 turnstiles GREEN · sanity: drop 62% ≤ 75% cap" },
      { level: "OK", text: "carriages repainted white — proceeding on Memory Line to Archive Terminus" },
      { level: "FIX", text: "archive: 2 brass fix-cards filed (comma-strip, terminal astype)" },
    ],
    newMemory: {
      nodes: [
        { id: "fix-commas", kind: "fix", label: "strip $ and commas", detail: "Currency cleanup before pd.to_numeric, else 1,200 → NaN", dataset: "ridership_customers_messy.csv" },
        { id: "fix-terminal", kind: "fix", label: "terminal astype block", detail: "df.astype({col: int64/float64/str/datetime64[ns]}) as the last step", dataset: "ridership_customers_messy.csv" },
      ],
      links: [
        { source: "fix-commas", target: "ds-ridership", label: "applies-to" },
        { source: "fix-terminal", target: "ds-ridership", label: "applies-to" },
        { source: "fix-commas", target: "fix-astype", label: "similar-to" },
      ],
    },
    carriages: ["clean", "rejected", "partial", "rejected"],
  },
];

/** Reverted state when the scrubber jumps back to attempt N. */
export function snapshotForAttempt(n: number) {
  const mem = baseMemory();
  for (let i = 0; i < n - 1; i++) {
    mem.nodes.push(...ATTEMPTS[i].newMemory.nodes);
    mem.links.push(...ATTEMPTS[i].newMemory.links);
  }
  return {
    codeVersion: n,
    scoreHistory: ATTEMPTS.slice(0, n - 1).map((a) => a.score),
    score: n === 1 ? 0 : ATTEMPTS[n - 2].score,
    memNodes: mem.nodes,
    memLinks: mem.links,
    rerouteOn: n >= 3,
    carriages: (n === 1 ? ["dirty", "dirty", "dirty", "dirty"] : ATTEMPTS[n - 2].carriages) as AttemptScript["carriages"],
  };
}

/** Fail-fast structural validation of the script itself (used by headless tests). */
export function validateScript(): string[] {
  const problems: string[] = [];
  if (ATTEMPTS.length !== 3) problems.push(`expected 3 attempts, got ${ATTEMPTS.length}`);
  const fails = ATTEMPTS.map((a) => a.checks.some((c) => c.status === "fail"));
  if (fails.join(",") !== "true,true,false") problems.push(`check outcomes should be fail,fail,pass — got ${fails.join(",")}`);
  const versions = ATTEMPTS.map((a) => a.codeVersion);
  if (versions.join(",") !== "1,2,3") problems.push(`code versions should ascend 1,2,3 — got ${versions.join(",")}`);
  const scores = ATTEMPTS.map((a) => a.score);
  if (!(scores[0] < scores[1] && scores[1] < scores[2])) problems.push(`scores should ascend — got ${scores.join(",")}`);
  for (const a of ATTEMPTS) {
    if (!CODE_VERSIONS[a.codeVersion - 1]?.includes("def clean(df):")) {
      problems.push(`attempt ${a.attempt}: code v${a.codeVersion} missing clean(df)`);
    }
    if (a.attempt < 3 && !a.errorFedBack) problems.push(`attempt ${a.attempt}: failing attempt needs errorFedBack`);
    if (a.attempt === 3 && a.errorFedBack) problems.push("attempt 3 must have no errorFedBack");
  }
  return problems;
}
