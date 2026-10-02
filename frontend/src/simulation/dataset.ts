import type { CarriageInfo } from "./types";

export const COLUMNS = [
  "customer_id",
  "name",
  "signup_date",
  "age",
  "email",
  "plan",
  "revenue",
] as const;

export const DATASET_META = {
  name: "ridership_customers_messy.csv",
  rules: "customer_id is required and unique. age must be non-negative. plan must be one of FREE, BASIC, PRO. revenue must be numeric and non-negative.",
  rowsIn: 8,
  rowsOut: 3,
};

export const TARGET_SCHEMA = `{
  "customer_id": {"type": "int", "nullable": false, "unique": true},
  "name": {"type": "str", "nullable": false},
  "signup_date": {"type": "datetime", "nullable": false},
  "age": {"type": "int", "nullable": false, "min_value": 0},
  "email": {"type": "str", "nullable": false, "format_hint": "email"},
  "plan": {"type": "str", "nullable": false, "allowed_values": ["FREE", "BASIC", "PRO"]},
  "revenue": {"type": "float", "nullable": false, "min_value": 0}
}`;

/** 4 carriages × 2 rows. Dirty = orange, cleaned = white. */
export const CARRIAGES: CarriageInfo[] = [
  {
    id: 1,
    label: "Batch A · rows 1–2",
    rows: [
      { values: ["201", "Ada Lovelace", "2024-02-01", "36", "ada@analytical.io", "PRO", "$79.99"], fate: "kept", reason: "clean after currency strip", cleaned: ["201", "Ada Lovelace", "2024-02-01", "36", "ada@analytical.io", "PRO", "79.99"] },
      { values: ["202", "grace hopper", "02/14/2024", "85", "GRACE@NAVY.MIL", "pro", "79.99"], fate: "kept", reason: "email lowercased, plan uppercased, date parsed via format='mixed' (name kept as-is)", cleaned: ["202", "grace hopper", "2024-02-14", "85", "grace@navy.mil", "PRO", "79.99"] },
    ],
  },
  {
    id: 2,
    label: "Batch B · rows 3–4",
    rows: [
      { values: ["203", "Alan Turing", "14-Feb-2024", "N/A", "alan@bletchley.uk", "FREE", "$0"], fate: "dropped", reason: "age 'N/A' is not a non-negative int" },
      { values: ["204", "", "2024-04-02", "29", "katherine@nasa.gov", "BASIC", "39.50"], fate: "dropped", reason: "name is required but empty" },
    ],
  },
  {
    id: 3,
    label: "Batch C · rows 5–6",
    rows: [
      { values: ["205", "John von Neumann", "not-a-date", "-4", "john@ias.edu", "ULTRA", "-12"], fate: "dropped", reason: "bad date, negative age, bad plan, negative revenue" },
      { values: ["206", "Margaret Hamilton", "2024-06-11", "87", "margaret@mit.edu", "BASIC", "$1,200"], fate: "kept", reason: "currency comma stripped → 1200.0", cleaned: ["206", "Margaret Hamilton", "2024-06-11", "87", "margaret@mit.edu", "BASIC", "1200.0"] },
    ],
  },
  {
    id: 4,
    label: "Batch D · rows 7–8",
    rows: [
      { values: ["202", "Grace Hopper (dup)", "02/14/2024", "85", "grace@navy.mil", "PRO", "79.99"], fate: "dropped", reason: "duplicate customer_id 202" },
      { values: ["207", "Tim Berners-Lee", "Feb 2024", "69", "tim@w3.org", "STARTER", "25"], fate: "dropped", reason: "plan STARTER not allowed" },
    ],
  },
];
