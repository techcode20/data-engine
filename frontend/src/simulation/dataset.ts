import type { CellFlag } from "./types";

export interface ColumnDef {
  key: string;
  label: string;
  dtype: string;
  /** 0-100 post-clean health. */
  health: number;
}

export const COLUMNS: ColumnDef[] = [
  { key: "customer_id", label: "customer_id", dtype: "int64", health: 100 },
  { key: "name", label: "name", dtype: "str", health: 90 },
  { key: "signup_date", label: "signup_date", dtype: "datetime64[ns]", health: 80 },
  { key: "email", label: "email", dtype: "str ✉", health: 80 },
  { key: "plan", label: "plan", dtype: "str ∈", health: 90 },
  { key: "revenue", label: "revenue", dtype: "float64 ≥ 0", health: 90 },
  { key: "is_active", label: "is_active", dtype: "bool", health: 100 },
  { key: "signup_source", label: "signup_source", dtype: "str", health: 70 },
];

export type Row = Record<string, string>;

/** Messy raw extract — every anomaly class appears at least once. */
export const RAW_ROWS: Row[] = [
  { customer_id: "101", name: "Amara Okafor", signup_date: "2024-01-15", email: "amara@northwind.io", plan: "PRO", revenue: "$49.99", is_active: "True", signup_source: "web" },
  { customer_id: "102", name: "  liam chen", signup_date: "01/22/2024", email: "LIAM@NORTHWIND.IO", plan: "pro", revenue: "49.99", is_active: "False", signup_source: "N/A" },
  { customer_id: "103", name: "Sofia Reyes", signup_date: "15-Jan-2024", email: "sofia@test", plan: "FREE", revenue: "$0", is_active: "True", signup_source: "mobile" },
  { customer_id: "104", name: "", signup_date: "2024-03-01", email: "bob@example.com", plan: "BASIC", revenue: "29.00", is_active: "True", signup_source: "web" },
  { customer_id: "105", name: "Max King", signup_date: "not-a-date", email: "max@example.com", plan: "PREMIUM", revenue: "-5", is_active: "False", signup_source: "web" },
  { customer_id: "106", name: "Tom Ray", signup_date: "2024-06-01", email: "tom@example.com", plan: "BASIC", revenue: "$12.50", is_active: "True", signup_source: "partner" },
  { customer_id: "102", name: "Liam Chen (dup)", signup_date: "01/22/2024", email: "liam@northwind.io", plan: "PRO", revenue: "49.99", is_active: "True", signup_source: "web" },
  { customer_id: "107", name: "Priya Nair", signup_date: "Jan 2024", email: "priya@northwind.io", plan: "STARTER", revenue: "15", is_active: "True", signup_source: "N/A" },
  { customer_id: "108", name: "Wei Zhang", signup_date: "2024-08-19", email: "wei@northwind.io", plan: "BASIC", revenue: "$9,999.00", is_active: "True", signup_source: "web" },
  { customer_id: "109", name: "Ana Gomez", signup_date: "2024-09-02", email: "ana@gomez.io", plan: "FREE", revenue: "0", is_active: "False", signup_source: "mobile" },
];

export const CLEAN_ROWS: Row[] = [
  { customer_id: "101", name: "Amara Okafor", signup_date: "2024-01-15", email: "amara@northwind.io", plan: "PRO", revenue: "49.99", is_active: "True", signup_source: "web" },
  { customer_id: "102", name: "Liam Chen", signup_date: "2024-01-22", email: "liam@northwind.io", plan: "PRO", revenue: "49.99", is_active: "False", signup_source: "web" },
  { customer_id: "106", name: "Tom Ray", signup_date: "2024-06-01", email: "tom@example.com", plan: "BASIC", revenue: "12.5", is_active: "True", signup_source: "partner" },
  { customer_id: "108", name: "Wei Zhang", signup_date: "2024-08-19", email: "wei@northwind.io", plan: "BASIC", revenue: "9999.0", is_active: "True", signup_source: "web" },
  { customer_id: "109", name: "Ana Gomez", signup_date: "2024-09-02", email: "ana@gomez.io", plan: "FREE", revenue: "0.0", is_active: "False", signup_source: "mobile" },
];

/** rowIndex -> columnKey -> flag. Matches the narrative in the script. */
export const RAW_FLAGS: Record<number, Record<string, CellFlag>> = {
  1: {
    name: { kind: "format", note: "Leading whitespace + wrong case" },
    signup_date: { kind: "format", note: "MM/DD/YYYY among ISO dates" },
    email: { kind: "format", note: "Uppercase email" },
    plan: { kind: "format", note: "Lowercase plan code" },
    signup_source: { kind: "null", note: '"N/A" sentinel, not a real source' },
  },
  2: {
    signup_date: { kind: "format", note: "DD-Mon-YYYY variant" },
    email: { kind: "format", note: "Missing TLD — fails email regex" },
  },
  3: {
    name: { kind: "null", note: "Required field is empty" },
  },
  4: {
    signup_date: { kind: "type", note: "Unparseable as datetime" },
    plan: { kind: "type", note: '"PREMIUM" not in [FREE, BASIC, PRO]' },
    revenue: { kind: "outlier", note: "Negative revenue violates min_value=0" },
  },
  6: {
    customer_id: { kind: "dup", note: "Duplicate of row 2 (id 102)" },
    name: { kind: "dup", note: "Duplicate identity, conflicting plan" },
  },
  7: {
    signup_date: { kind: "format", note: '"Jan 2024" — month precision only' },
    plan: { kind: "type", note: '"STARTER" not an allowed plan' },
    signup_source: { kind: "null", note: '"N/A" sentinel' },
  },
  8: {
    revenue: { kind: "outlier", note: "$9,999 — 200× the median; kept, flagged" },
  },
};

export const DATASET_META = {
  name: "northwind_customers_messy.csv",
  rules: "customer_id is required and unique. name is required. plan must be one of FREE, BASIC, PRO. revenue must be numeric and non-negative.",
  rowsIn: RAW_ROWS.length,
  rowsOut: CLEAN_ROWS.length,
  cols: COLUMNS.length,
};

export const TARGET_SCHEMA = `{
  "customer_id": {"type": "int", "nullable": false, "unique": true},
  "name": {"type": "str", "nullable": false},
  "signup_date": {"type": "datetime", "nullable": false},
  "email": {"type": "str", "nullable": false, "format_hint": "email"},
  "plan": {"type": "str", "nullable": false, "allowed_values": ["FREE", "BASIC", "PRO"]},
  "revenue": {"type": "float", "nullable": false, "min_value": 0},
  "is_active": {"type": "bool", "nullable": false},
  "signup_source": {"type": "str", "nullable": true}
}`;
