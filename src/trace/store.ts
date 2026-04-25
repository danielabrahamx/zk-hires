import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { TraceEvent } from "./events";

/**
 * SQLite-backed trace store.
 *
 * Single DB file at data/traces.db (gitignored). Connection is lazily
 * created on first use and reused for the process lifetime. Tests can
 * override the path via the TRACES_DB_PATH env var.
 *
 * TODO Phase 4: merkleRootForRun should switch to real Poseidon (BN254)
 * so trace_root matches what the Noir circuit can verify. For Phase 1
 * we use a sha256-of-concat placeholder that satisfies the same shape
 * (deterministic bigint over event hashes) and can be swapped without
 * touching the call sites.
 */

const DEFAULT_DB_PATH = resolve(process.cwd(), "data", "traces.db");

let db: Database.Database | null = null;
let currentPath: string | null = null;

function getDb(): Database.Database {
  const path = process.env.TRACES_DB_PATH ?? DEFAULT_DB_PATH;
  if (db && currentPath === path) return db;
  if (db && currentPath !== path) {
    db.close();
    db = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const handle = new Database(path);
  handle.pragma("journal_mode = WAL");
  handle.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      error TEXT,
      evidence_ids TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_traces_run ON traces(run_id);
  `);
  db = handle;
  currentPath = path;
  return handle;
}

/** Test-only: close the cached connection so a new path is honoured next call. */
export function _resetTraceStore(): void {
  if (db) {
    db.close();
    db = null;
    currentPath = null;
  }
}

export function recordEvent(event: TraceEvent): void {
  const stmt = getDb().prepare(`
    INSERT INTO traces (ts, run_id, agent, action, input, output, latency_ms, error, evidence_ids)
    VALUES (@ts, @run_id, @agent, @action, @input, @output, @latency_ms, @error, @evidence_ids)
  `);
  stmt.run({
    ts: event.ts,
    run_id: event.run_id,
    agent: event.agent,
    action: event.action,
    input: JSON.stringify(event.input ?? null),
    output: JSON.stringify(event.output ?? null),
    latency_ms: event.latency_ms,
    error: event.error ?? null,
    evidence_ids: JSON.stringify(event.evidence_ids ?? []),
  });
}

type Row = {
  id: number;
  ts: number;
  run_id: string;
  agent: string;
  action: string;
  input: string;
  output: string;
  latency_ms: number;
  error: string | null;
  evidence_ids: string;
};

export function getEventsByRunId(runId: string): TraceEvent[] {
  const rows = getDb()
    .prepare(`SELECT * FROM traces WHERE run_id = ? ORDER BY id ASC`)
    .all(runId) as Row[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    run_id: r.run_id,
    agent: r.agent as TraceEvent["agent"],
    action: r.action,
    input: JSON.parse(r.input),
    output: JSON.parse(r.output),
    latency_ms: r.latency_ms,
    error: r.error ?? undefined,
    evidence_ids: JSON.parse(r.evidence_ids),
  }));
}

function hashEventLeaf(e: TraceEvent): bigint {
  const canonical = JSON.stringify({
    ts: e.ts,
    run_id: e.run_id,
    agent: e.agent,
    action: e.action,
    input: e.input,
    output: e.output,
    latency_ms: e.latency_ms,
    error: e.error ?? null,
    evidence_ids: e.evidence_ids,
  });
  const digest = sha256(utf8ToBytes(canonical));
  let hex = "0x";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

/**
 * merkleRootForRun - deterministic root over all TraceEvents for a run.
 *
 * TODO Phase 4: replace with real Poseidon-of-hashes using circomlibjs.
 * For now: sha256 over concatenated leaf bytes. Empty run -> 0n.
 */
export function merkleRootForRun(runId: string): bigint {
  const events = getEventsByRunId(runId);
  if (events.length === 0) return 0n;
  const leafHexes = events.map((e) => hashEventLeaf(e).toString(16));
  const concat = leafHexes.join("|");
  const digest = sha256(utf8ToBytes(concat));
  let hex = "0x";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}
