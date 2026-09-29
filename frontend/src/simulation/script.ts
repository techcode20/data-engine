import type { AttemptScript, MemoryLink, MemoryNode } from "./types";

export const CODE_V1 = `def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "email",
                "plan", "revenue", "is_active", "signup_source"]
    df = df.dropna(subset=required)

    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df["customer_id"] = df["customer_id"].astype(int)
    df = df.drop_duplicates(subset=["customer_id"])

    df["signup_date"] = pd.to_datetime(df["signup_date"], errors="coerce")
    df = df.dropna(subset=["signup_date"])

    df["email"] = df["email"].astype(str).str.lower().str.strip()
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]

    df["revenue"] = df["revenue"].replace(r"[^\\d.]", "", regex=True)
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])

    return df[required].reset_index(drop=True)`;

export const CODE_V2 = `def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "email",
                "plan", "revenue", "is_active", "signup_source"]
    df = df.dropna(subset=required)
    df["name"] = df["name"].astype(str).str.strip()
    df = df[df["name"] != ""]

    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df["customer_id"] = df["customer_id"].astype(int)
    df = df.drop_duplicates(subset=["customer_id"])

    df["signup_date"] = pd.to_datetime(df["signup_date"], errors="coerce")
    df = df.dropna(subset=["signup_date"])

    df["email"] = df["email"].astype(str).str.lower().str.strip()
    email_re = r"^[^@]+@[^@]+\\.[^@]+$"
    df = df[df["email"].str.match(email_re, na=False)]
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]

    df["revenue"] = df["revenue"].astype(str).str.replace("$", "", regex=False)
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])
    df = df[df["revenue"] >= 0]

    df["is_active"] = df["is_active"].map(
        {"True": True, "False": False, True: True, False: False})
    return df[required].reset_index(drop=True)`;

export const CODE_V3 = `def clean(df):
    df = df.copy()
    required = ["customer_id", "name", "signup_date", "email",
                "plan", "revenue", "is_active", "signup_source"]
    df = df.dropna(subset=required)
    df["name"] = df["name"].astype(str).str.strip()
    df = df[df["name"] != ""]

    df["customer_id"] = pd.to_numeric(df["customer_id"], errors="coerce")
    df = df.dropna(subset=["customer_id"])
    df = df[df["customer_id"] >= 1]
    df = df.drop_duplicates(subset=["customer_id"])

    # pandas 3 infers ONE datetime format per Series: without
    # format="mixed", valid dates in other formats silently become NaT.
    df["signup_date"] = pd.to_datetime(
        df["signup_date"], format="mixed", errors="coerce")
    df = df.dropna(subset=["signup_date"])

    df["email"] = df["email"].astype(str).str.lower().str.strip()
    email_re = r"^[^@]+@[^@]+\\.[^@]+$"
    df = df[df["email"].str.match(email_re, na=False)]
    df["plan"] = df["plan"].astype(str).str.upper().str.strip()
    df = df[df["plan"].isin(["FREE", "BASIC", "PRO"])]

    df["revenue"] = (df["revenue"].astype(str).str.replace("$", "", regex=False)
                     .str.replace(",", "", regex=False).str.strip())
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    df = df.dropna(subset=["revenue"])
    df = df[df["revenue"] >= 0]

    df["is_active"] = df["is_active"].map(
        {"True": True, "False": False, True: True, False: False,
         "true": True, "false": False, 1: True, 0: False})

    df = df.astype({
        "customer_id": "int64", "name": "str",
        "signup_date": "datetime64[ns]", "email": "str", "plan": "str",
        "revenue": "float64", "is_active": "bool", "signup_source": "str",
    })
    return df[required].reset_index(drop=True)`;

export const CODE_VERSIONS = [CODE_V1, CODE_V2, CODE_V3];

const BASE_MEMORY: { nodes: MemoryNode[]; links: MemoryLink[] } = {
  nodes: [
    { id: "ds-northwind", kind: "dataset", label: "northwind_customers", detail: "10 rows · 8 cols · CSV", dataset: "northwind_customers_messy.csv" },
    { id: "err-dtype", kind: "error", label: "dtype mismatch", detail: "clean() output dtype != pandera Column dtype", dataset: "sample_data_2.csv" },
    { id: "fix-astype", kind: "fix", label: "explicit astype() casts", detail: "Finish with df.astype({col: int64/float64/bool/str/datetime64[ns]})", dataset: "sample_data_2.csv" },
    { id: "err-bool", kind: "error", label: "bool vs boolean", detail: "nullable 'boolean' != numpy 'bool' in pandera strict check", dataset: "api.github.com/users" },
    { id: "fix-boolmap", kind: "fix", label: "bool map + astype('bool')", detail: "Map True/False strings, 1/0, then .astype('bool') — never leave as object", dataset: "api.github.com/users" },
  ],
  links: [
    { source: "err-dtype", target: "fix-astype", label: "resolved-by" },
    { source: "err-bool", target: "fix-boolmap", label: "resolved-by" },
    { source: "fix-astype", target: "ds-northwind", label: "applies-to" },
  ],
};

export function baseMemory() {
  return JSON.parse(JSON.stringify(BASE_MEMORY)) as typeof BASE_MEMORY;
}

export const ATTEMPTS: AttemptScript[] = [
  {
    attempt: 1,
    codeVersion: 1,
    score: 34,
    summary: "First pass: drops nulls and dupes, but dates and currency parsing are naive.",
    checks: [
      { id: "c-id", label: "customer_id · int, unique, non-null", status: "pass", detail: "10 → 9 rows, dup id 102 removed" },
      { id: "c-date", label: "signup_date · datetime64[ns]", status: "fail", detail: "4 values became NaT — mixed formats need format=\"mixed\"" },
      { id: "c-email", label: "email · valid format", status: "fail", detail: "\"sofia@test\" has no TLD; no regex check present" },
      { id: "c-plan", label: "plan ∈ FREE, BASIC, PRO", status: "pass", detail: "PREMIUM / STARTER filtered" },
      { id: "c-rev", label: "revenue · float ≥ 0", status: "fail", detail: "\"$9,999.00\" → 9999.0 ok, but \"-$5\" handling unguarded; negative slipped a filter" },
      { id: "c-bool", label: "is_active · bool", status: "fail", detail: "object dtype — 'True'/'False' strings never cast" },
    ],
    errorFedBack:
      "column 'signup_date' failure_case dtype('datetime64[ns]') — 4 NaT after coerce (mixed formats: MM/DD/YYYY, DD-Mon-YYYY, 'Jan 2024'). column 'is_active' dtype('bool') vs object. column 'email' failed str_contains('@')? no — missing TLD 'sofia@test'.",
    logs: [
      { level: "INFO", text: "ingest: 10 rows × 8 cols · nulls: name×1, signup_source×2(N/A)" },
      { level: "INFO", text: "infer_schema: 8 columns proposed (int×1 float×1 bool×1 datetime×1 str×4)" },
      { level: "INFO", text: "generate_transform_code: v1 written (41 lines)" },
      { level: "INFO", text: "sandbox: clean() executed in 0.42s — no exception" },
      { level: "ERROR", text: "validate: 4 check failures — signup_date dtype, email format, revenue bound, is_active dtype" },
      { level: "WARN", text: "self-correct: feeding failure_cases back to the model (attempt 1/5)" },
      { level: "FIX", text: "log_fix: recorded dtype-mismatch signature for future runs" },
    ],
    newMemory: {
      nodes: [
        { id: "err-dates", kind: "error", label: "mixed date formats", detail: "MM/DD/YYYY + DD-Mon-YYYY + 'Jan 2024' in one column", dataset: "northwind_customers_messy.csv" },
      ],
      links: [{ source: "err-dates", target: "ds-northwind", label: "seen-in" }],
    },
  },
  {
    attempt: 2,
    codeVersion: 2,
    score: 71,
    summary: "Adds email regex, name guard, revenue floor and bool mapping — but keeps bare to_datetime.",
    checks: [
      { id: "c-id", label: "customer_id · int, unique, non-null", status: "pass", detail: "9 rows, ids unique" },
      { id: "c-date", label: "signup_date · datetime64[ns]", status: "fail", detail: "Still 3 NaT — pandas 3 infers ONE format per Series ('2024-01-15' wins, rest die)" },
      { id: "c-email", label: "email · valid format", status: "pass", detail: "Regex ^[^@]+@[^@]+\\.[^@]+$ drops sofia@test" },
      { id: "c-plan", label: "plan ∈ FREE, BASIC, PRO", status: "pass", detail: "Clean" },
      { id: "c-rev", label: "revenue · float ≥ 0", status: "pass", detail: "Currency stripped, floor enforced" },
      { id: "c-bool", label: "is_active · bool", status: "fail", detail: "Mapped but left as object — missing final astype('bool')" },
    ],
    errorFedBack:
      "column 'signup_date' STILL dtype failure — 3 NaT. Root cause: pandas 3 strict per-Series format inference. Fix: pd.to_datetime(..., format=\"mixed\"). column 'is_active' still object — add terminal astype block.",
    logs: [
      { level: "INFO", text: "fix_transform_code: v2 written — email regex + revenue floor + bool map" },
      { level: "INFO", text: "sandbox: clean() executed in 0.38s — no exception" },
      { level: "WARN", text: "validate: 2 remaining — signup_date (3 NaT), is_active (object vs bool)" },
      { level: "ERROR", text: "diagnosis: bare pd.to_datetime + pandas 3 single-format inference = silent NaT" },
      { level: "FIX", text: "self-correct: targeted patch — format=\"mixed\" + terminal astype dict (attempt 2/5)" },
      { level: "FIX", text: "log_fix: recorded pandas-3-datetime signature" },
    ],
    newMemory: {
      nodes: [
        { id: "fix-mixed", kind: "fix", label: 'format="mixed" datetimes', detail: "pd.to_datetime(..., format='mixed') for multi-format columns on pandas 3", dataset: "northwind_customers_messy.csv" },
        { id: "fix-terminal", kind: "fix", label: "terminal astype block", detail: "df.astype({col: int64/float64/bool/str/datetime64[ns]}) as the last step", dataset: "northwind_customers_messy.csv" },
      ],
      links: [
        { source: "err-dates", target: "fix-mixed", label: "resolved-by" },
        { source: "err-bool", target: "fix-terminal", label: "resolved-by" },
        { source: "fix-mixed", target: "ds-northwind", label: "applies-to" },
      ],
    },
  },
  {
    attempt: 3,
    codeVersion: 3,
    score: 98,
    summary: "Terminal dtype casts + mixed-format parsing. All checks green, 5 rows out.",
    checks: [
      { id: "c-id", label: "customer_id · int, unique, non-null", status: "pass", detail: "5 rows, ids 101,102,106,108,109" },
      { id: "c-date", label: "signup_date · datetime64[ns]", status: "pass", detail: "All 4 formats parsed via format=\"mixed\"" },
      { id: "c-email", label: "email · valid format", status: "pass", detail: "Lowercased, TLD enforced" },
      { id: "c-plan", label: "plan ∈ FREE, BASIC, PRO", status: "pass", detail: "Cased + filtered" },
      { id: "c-rev", label: "revenue · float ≥ 0", status: "pass", detail: "$/commas stripped, negatives dropped" },
      { id: "c-bool", label: "is_active · bool", status: "pass", detail: "Mapped + astype('bool')" },
    ],
    errorFedBack: null,
    logs: [
      { level: "INFO", text: "fix_transform_code: v3 written — mixed dates + terminal casts + comma handling" },
      { level: "INFO", text: "sandbox: clean() executed in 0.44s — no exception" },
      { level: "OK", text: "validate: 6/6 checks passed · sanity: drop 50% ≤ 75% cap · no new null cols" },
      { level: "OK", text: "run complete: 3 attempts · 5 rows cleaned, 5 dropped · score 98/100" },
      { level: "FIX", text: "code_cache: clean() stored under schema hash — next identical run costs $0" },
    ],
    newMemory: {
      nodes: [
        { id: "fix-commas", kind: "fix", label: "strip $ and commas", detail: "Currency cleanup before pd.to_numeric, else 9,999 → NaN", dataset: "northwind_customers_messy.csv" },
      ],
      links: [{ source: "fix-commas", target: "ds-northwind", label: "applies-to" }],
    },
  },
];

export const STAGE_ORDER = [
  "ingest",
  "infer",
  "generate",
  "sandbox",
  "validate",
  "self-correct",
  "log-fix",
] as const;
