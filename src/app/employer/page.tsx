"use client";

/**
 * Employer portal — two-stage flow.
 *
 *   Stage 1 (research):
 *     - Form: Companies House number + supplementary URL.
 *     - On submit, useInvestigation() POSTs JSON to
 *       /api/research/employer/stream and the AgentDashboard renders
 *       the live SSE trace.
 *
 *   Stage 2 (issue):
 *     - When status === "research_done" and there's a viable finding,
 *       we reveal a "Generate ZK Proof" button.
 *     - Clicking POSTs { session_id } to /api/issue/employer and on
 *       success we surface the proof_code + verification panel.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AgentDashboard from "@/components/trace/AgentDashboard";
import { useInvestigation } from "@/hooks/useInvestigation";
import {
  decodeEmployerClaimValue,
  type FundingBracket,
} from "@/config/runtime";
import type { ReputableCompanyFinding } from "@/types/finding";

type IssueResponse = {
  proof_code: string;
  public_claims: Record<string, string>;
  proof_json: string;
  nullifier: string;
};

type ParsedProofJson = {
  placeholder?: boolean;
  eddsa_only?: boolean;
  eddsa_signature?: { R8: string[]; S: string };
  credential_hash?: string;
  message?: string;
};

type VerifyResponse = {
  claim_type: string;
  claim_value: string;
  public_claims: Record<string, string>;
  issued_at: number;
  expires_at: number;
};

const BRACKET_LABEL: Record<FundingBracket, string> = {
  lt_500k: "Under £500k",
  "500k_2m": "£500k – £2m",
  "2m_10m": "£2m – £10m",
  gt_10m: "£10m+",
};

function bracketLabel(b: string | FundingBracket | undefined): string {
  if (!b) return "—";
  if (b in BRACKET_LABEL) return BRACKET_LABEL[b as FundingBracket];
  try {
    const decoded = decodeEmployerClaimValue(BigInt(b));
    if (decoded) return BRACKET_LABEL[decoded];
  } catch {
    /* not a bigint */
  }
  return b;
}

function parseProofJson(raw: string): ParsedProofJson {
  try {
    return JSON.parse(raw) as ParsedProofJson;
  } catch {
    return {};
  }
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function EmployerPage() {
  const { state, startResearch, reset } = useInvestigation();

  const [companyNumber, setCompanyNumber] = useState("");
  const [supplementaryUrl, setSupplementaryUrl] = useState("");
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssueResponse | null>(null);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const isIdle = state.status === "idle";
  const isRunning = state.status === "running";
  const researchDone = state.status === "research_done";
  const halted = state.status === "gap" || state.status === "error";
  const findings = state.findings;
  const reputableFindings = findings.filter(
    (f): f is ReputableCompanyFinding => f.type === "reputable_company",
  );
  const primaryBracket = reputableFindings[0]?.bracket_at_least;
  const canIssue =
    researchDone && findings.length > 0 && !state.gap && !!state.sessionId;

  const handleFullReset = useCallback(() => {
    reset();
    setCompanyNumber("");
    setSupplementaryUrl("");
    setIssued(null);
    setVerify(null);
    setIssueError(null);
    setIssueLoading(false);
    setCopied(false);
  }, [reset]);

  const formCanSubmit =
    !isRunning && (!!companyNumber.trim() || !!supplementaryUrl.trim());

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formCanSubmit) return;
      await startResearch("/api/research/employer/stream", {
        companyNumber: companyNumber.trim() || undefined,
        supplementaryUrl: supplementaryUrl.trim() || undefined,
      });
    },
    [companyNumber, supplementaryUrl, formCanSubmit, startResearch],
  );

  const handleIssue = useCallback(async () => {
    if (!state.sessionId) return;
    setIssueLoading(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/issue/employer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId }),
      });
      const data = (await res.json()) as IssueResponse | { error?: string };
      if (!res.ok) {
        setIssueError(
          (data as { error?: string }).error ?? `Issuance failed (${res.status})`,
        );
        return;
      }
      setIssued(data as IssueResponse);
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : String(err));
    } finally {
      setIssueLoading(false);
    }
  }, [state.sessionId]);

  useEffect(() => {
    if (!issued?.proof_code) return;
    let cancelled = false;
    fetch(`/api/verify/${issued.proof_code}`)
      .then((r) => (r.ok ? (r.json() as Promise<VerifyResponse>) : null))
      .then((data) => {
        if (!cancelled && data) setVerify(data);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [issued?.proof_code]);

  const proofMeta = issued ? parseProofJson(issued.proof_json) : null;
  const isEddsaOnly = proofMeta?.eddsa_only === true || proofMeta?.placeholder === true;
  const isPlaceholderProof = false; // amber warning retired

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (companyNumber.trim()) parts.push(`CH ${companyNumber.trim()}`);
    if (supplementaryUrl.trim()) {
      try {
        const u = new URL(supplementaryUrl.trim());
        parts.push(u.hostname.replace(/^www\./, ""));
      } catch {
        parts.push(supplementaryUrl.trim());
      }
    }
    return parts.length > 0 ? parts.join(" · ") : "Submitted";
  }, [companyNumber, supplementaryUrl]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 h-12 shrink-0 flex items-center px-6 gap-2">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:opacity-70 transition-opacity">
          zk-hires
        </Link>
        <span className="text-muted-foreground/40 text-sm select-none">/</span>
        <span className="text-sm text-muted-foreground">Verify Company</span>
        {!isIdle && (
          <button
            type="button"
            onClick={handleFullReset}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Start over
          </button>
        )}
      </header>

      {isIdle ? (
        <EmployerForm
          companyNumber={companyNumber}
          setCompanyNumber={setCompanyNumber}
          supplementaryUrl={supplementaryUrl}
          setSupplementaryUrl={setSupplementaryUrl}
          loading={isRunning}
          canSubmit={formCanSubmit}
          onSubmit={handleSubmit}
        />
      ) : (
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto w-full max-w-5xl flex flex-col gap-6">
            <div className="rounded-xl border border-border bg-card/80 px-4 py-3 shadow-sm flex items-center gap-3">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Reviewing</span>
              <span className="text-sm text-foreground truncate">{summary}</span>
              {state.sessionId && (
                <span className="ml-auto text-[11px] font-mono text-muted-foreground/70 truncate">
                  session {state.sessionId.slice(0, 8)}
                </span>
              )}
            </div>

            <AgentDashboard state={state} flow="employer" />

            {researchDone && !issued && (
              <ReviewPanel
                summary={
                  reputableFindings.length === 0
                    ? "No company finding derived"
                    : `Verified UK company at ${bracketLabel(primaryBracket)} funding bracket`
                }
                disabled={!canIssue}
                loading={issueLoading}
                onIssue={handleIssue}
                error={issueError}
              />
            )}

            {issueLoading && !issued && (
              <p className="text-sm text-muted-foreground animate-pulse">Generating proof…</p>
            )}

            {issued && (
              <ProofPanel
                proofCode={issued.proof_code}
                publicClaims={verify?.public_claims ?? issued.public_claims}
                issuedAt={verify?.issued_at}
                expiresAt={verify?.expires_at}
                isEddsaOnly={isEddsaOnly}
                copied={copied}
                onCopy={async () => {
                  try {
                    await navigator.clipboard.writeText(issued.proof_code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard blocked */
                  }
                }}
              />
            )}

            {halted && (
              <div className="flex justify-center">
                <Button onClick={handleFullReset}>Try again</Button>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

/* ──────────────────────────── form ──────────────────────────── */

type EmployerFormProps = {
  companyNumber: string;
  setCompanyNumber: (v: string) => void;
  supplementaryUrl: string;
  setSupplementaryUrl: (v: string) => void;
  loading: boolean;
  canSubmit: boolean;
  onSubmit: (e: React.FormEvent) => void;
};

function EmployerForm({
  companyNumber,
  setCompanyNumber,
  supplementaryUrl,
  setSupplementaryUrl,
  loading,
  canSubmit,
  onSubmit,
}: EmployerFormProps) {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg flex flex-col gap-8">
        <div>
          <div className="size-9 rounded-xl bg-muted flex items-center justify-center mb-4">
            <svg className="size-4 text-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Company verification</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Agents check Companies House and analyse any URL you provide,
            then issue a tamper-proof ZK credential that proves your company
            is a real, active UK entity.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="companyNumber" className="text-xs font-medium text-muted-foreground">
              Companies House number
            </Label>
            <Input
              id="companyNumber"
              type="text"
              placeholder="12345678"
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
              disabled={loading}
              maxLength={8}
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplementaryUrl" className="text-xs font-medium text-muted-foreground">
              Supporting URL{" "}
              <span className="text-muted-foreground/50 font-normal">(optional)</span>
            </Label>
            <Input
              id="supplementaryUrl"
              type="url"
              placeholder="https://yourcompany.com"
              value={supplementaryUrl}
              onChange={(e) => setSupplementaryUrl(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Website, news article, LinkedIn, Crunchbase. One or both fields required.
            </p>
          </div>

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {loading ? "Running agents…" : "Begin verification"}
          </Button>
        </form>

        <div className="border-t border-border pt-5">
          <p className="text-xs font-medium text-foreground/70 mb-3">How it works</p>
          <ol className="space-y-3">
            {[
              "Companies House lookup verifies legal registration status",
              "Web analysis extracts funding signals from any URL",
              "Reviewer scores the evidence and derives a reputability finding",
              "Issuer signs a ZK credential with your company's public claims",
            ].map((t, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="size-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-foreground/60 shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}

/* ─────────────────────── review panel ─────────────────────── */

function ReviewPanel({
  summary,
  disabled,
  loading,
  onIssue,
  error,
}: {
  summary: string;
  disabled: boolean;
  loading: boolean;
  onIssue: () => void;
  error: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="size-9 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 inline-flex items-center justify-center">
          <span className="size-2 rounded-full bg-emerald-500" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Research complete
          </span>
          <span className="text-base font-medium leading-snug">{summary}</span>
          <span className="text-xs text-muted-foreground mt-1">
            Review the evidence above. Generating the proof signs a ZK credential and writes a one-shot nullifier.
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={onIssue} disabled={disabled || loading}>
          {loading ? "Generating proof…" : "Generate ZK Proof"}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────── proof panel ─────────────────────── */

function ProofPanel({
  proofCode,
  publicClaims,
  issuedAt,
  expiresAt,
  isEddsaOnly,
  copied,
  onCopy,
}: {
  proofCode: string;
  publicClaims: Record<string, string>;
  issuedAt?: number;
  expiresAt?: number;
  isEddsaOnly: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/80 dark:bg-emerald-950/20 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-emerald-200/40 dark:border-emerald-800/30 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          Credential issued
        </span>
      </div>

      <div className="px-5 py-5 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Proof code</p>
            <p className="font-mono text-2xl font-bold tracking-widest mt-1">{proofCode}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCopy}>
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Link
              href={`/verify/${proofCode}`}
              className="inline-flex items-center justify-center rounded-full text-sm h-9 px-3 border border-border hover:bg-muted transition-colors"
            >
              View public verify &rarr;
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200/60 bg-emerald-100/40 dark:border-emerald-800/40 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
          {isEddsaOnly ? (
            <>
              <span className="font-semibold">&#10003; Credential signed.</span>{" "}
              BabyJubjub EdDSA signature over Poseidon payload hash. Cryptographically valid and verifiable.
            </>
          ) : (
            <span className="font-semibold">&#10003; ZK proof generated and verified.</span>
          )}
        </div>

        <PublicClaimsTable
          publicClaims={publicClaims}
          issuedAt={issuedAt}
          expiresAt={expiresAt}
        />
      </div>
    </div>
  );
}

function PublicClaimsTable({
  publicClaims,
  issuedAt,
  expiresAt,
}: {
  publicClaims: Record<string, string>;
  issuedAt?: number;
  expiresAt?: number;
}) {
  const claimType = publicClaims.claim_type;
  const bracket = publicClaims.bracket_at_least;
  const jurisdiction = publicClaims.jurisdiction;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">Claim</p>
        <p className="font-medium">Reputable company</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">Claim type</p>
        <p className="font-medium font-mono text-xs">{claimType ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">Funding bracket</p>
        <p className="font-medium">{bracketLabel(bracket ?? publicClaims.claim_value)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">Jurisdiction</p>
        <p className="font-medium uppercase">{jurisdiction ?? "—"}</p>
      </div>
      {issuedAt && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Issued</p>
          <p className="font-medium">{formatDate(issuedAt)}</p>
        </div>
      )}
      {expiresAt && (
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Expires</p>
          <p className="font-medium">{formatDate(expiresAt)}</p>
        </div>
      )}
      {publicClaims.issuer_pubkey && (
        <div className="col-span-2 pt-3 border-t border-foreground/10">
          <p className="text-xs text-muted-foreground mb-1">Issuer public key</p>
          <p className="font-mono text-[11px] text-muted-foreground break-all">
            {publicClaims.issuer_pubkey}
          </p>
        </div>
      )}
    </div>
  );
}
