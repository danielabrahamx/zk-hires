import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
  type TraceEvent,
  type TraceEventKind,
  type WireTraceEvent,
  inferKind,
  toWireEvent,
} from "./events";

/**
 * SQLite-backed trace store with in-process pub/sub for live SSE.
 *
 * Single DB file at data/traces.db (gitignored). Connection is lazily
 * created on first use and reused for the process lifetime. Tests can
 * override the path via the TRACES_DB_PATH env var.
 *
 * Pub/sub: subscribers register with a run_id. Every recordEvent
 * for that run_id pushes a wire-shape event to all subscribers.
 * SSE routes use this to stream agent activity to the browser.
 */

const DEFAULT_DB_PATH = resolve(process.cwd(), "data", "traces.db");

let db: Database.Database | null = null;
let currentPath: string | null = null;

function ensureColumn(handle: Database.Database, table: string, column: string, type: string): void {
  const cols = handle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

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
      evidence_ids TEXT NOT NULL,
      kind TEXT,
      message TEXT,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_traces_run ON traces(run_id);
    CREATE TABLE IF NOT EXISTS credentials (
      proof_code TEXT PRIMARY KEY,
      claim_type TEXT NOT NULL,
      claim_value TEXT NOT NULL,
      proof_json TEXT NOT NULL,
      public_claims TEXT NOT NULL,
      nullifier TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_sessions (
      session_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      claim_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_run ON research_sessions(run_id);
  `);
  // Migrations for existing DBs missing new columns.
  ensureColumn(handle, "traces", "kind", "TEXT");
  ensureColumn(handle, "traces", "message", "TEXT");
  ensureColumn(handle, "traces", "data", "TEXT");
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
  subscribers.clear();
}

/* ---------------- pub/sub for live SSE ----------------- */

type Subscriber = (e: WireTraceEvent) => void;
const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(runId: string, fn: Subscriber): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(fn);
  return () => {
    const s = subscribers.get(runId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(runId);
  };
}

function fanout(event: TraceEvent): void {
  const set = subscribers.get(event.run_id);
  if (!set || set.size === 0) return;
  const wire = toWireEvent(event);
  for (const fn of set) {
    try {
      fn(wire);
    } catch {
      // Subscriber failures must not break the trace pipeline.
    }
  }
}

export function recordEvent(event: TraceEvent): void {
  const kind: TraceEventKind = event.kind ?? inferKind(event.action, Boolean(event.error));
  const message = event.message ?? event.action;
  const stmt = getDb().prepare(`
    INSERT INTO traces (ts, run_id, agent, action, input, output, latency_ms, error, evidence_ids, kind, message, data)
    VALUES (@ts, @run_id, @agent, @action, @input, @output, @latency_ms, @error, @evidence_ids, @kind, @message, @data)
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
    kind,
    message,
    data: event.data === undefined ? null : JSON.stringify(event.data),
  });
  fanout({ ...event, kind, message });
}

/**
 * Convenience helper - emit a TraceEvent without computing latency yourself.
 * Use for one-shot events that aren't a start/done pair.
 */
export function emitEvent(args: {
  run_id: string;
  agent: TraceEvent["agent"];
  kind: TraceEventKind;
  message: string;
  data?: unknown;
  evidence_ids?: string[];
  error?: string;
}): void {
  recordEvent({
    ts: Date.now(),
    run_id: args.run_id,
    agent: args.agent,
    action: args.message,
    kind: args.kind,
    message: args.message,
    data: args.data,
    input: null,
    output: args.data ?? null,
    latency_ms: 0,
    error: args.error,
    evidence_ids: args.evidence_ids ?? [],
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
  kind: string | null;
  message: string | null;
  data: string | null;
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
    kind: (r.kind as TraceEventKind) ?? undefined,
    message: r.message ?? undefined,
    data: r.data ? JSON.parse(r.data) : undefined,
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

export interface CredentialRow {
  proof_code: string;
  claim_type: string;
  claim_value: string;
  proof_json: string;
  public_claims: Record<string, string>;
  nullifier: string;
  issued_at: number;
  expires_at: number;
}

type CredentialDbRow = Omit<CredentialRow, "public_claims"> & {
  public_claims: string;
};

export function storeCredential(row: CredentialRow): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO credentials
       (proof_code, claim_type, claim_value, proof_json, public_claims, nullifier, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.proof_code,
      row.claim_type,
      row.claim_value,
      row.proof_json,
      JSON.stringify(row.public_claims),
      row.nullifier,
      row.issued_at,
      row.expires_at
    );
}

export function lookupCredential(proofCode: string): CredentialRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM credentials WHERE proof_code = ?`)
    .get(proofCode) as CredentialDbRow | undefined;
  if (!row) return null;
  return {
    ...row,
    public_claims: JSON.parse(row.public_claims) as Record<string, string>,
  };
}

/* ---------------- research session bridge ----------------- */

/**
 * A research session captures the Researcher+Reviewer output between the
 * "research" phase and the "issue" phase, so the user can review evidence
 * before clicking Generate Proof. session_id is opaque to the client.
 */
export interface ResearchSessionRow {
  session_id: string;
  run_id: string;
  claim_type: string;
  payload: string; // JSON: { evidence, findings, gap }
  created_at: number;
  consumed_at: number | null;
}

export function storeResearchSession(row: Omit<ResearchSessionRow, "consumed_at">): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO research_sessions
       (session_id, run_id, claim_type, payload, created_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .run(row.session_id, row.run_id, row.claim_type, row.payload, row.created_at);
}

export function lookupResearchSession(sessionId: string): ResearchSessionRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM research_sessions WHERE session_id = ?`)
    .get(sessionId) as ResearchSessionRow | undefined;
  return row ?? null;
}

export function markResearchSessionConsumed(sessionId: string): void {
  getDb()
    .prepare(`UPDATE research_sessions SET consumed_at = ? WHERE session_id = ?`)
    .run(Date.now(), sessionId);
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
