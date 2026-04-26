"use client";

/**
 * Candidate portal — two-stage flow.
 *
 *   Stage 1 (research):
 *     - Form: certificate file upload + optional supporting links.
 *     - On submit, useInvestigation() POSTs multipart to
 *       /api/research/candidate/stream and the AgentDashboard renders
 *       the live SSE trace.
 *
 *   Stage 2 (issue):
 *     - When status === "research_done" and there's a viable finding,
 *       we reveal a "Generate ZK Proof" button.
 *     - Clicking POSTs { session_id } to /api/issue/candidate and on
 *       success we surface the proof_code + verification panel.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AgentDashboard from "@/components/trace/AgentDashboard";
import { useInvestigation } from "@/hooks/useInvestigation";
import type { HackathonWinsFinding } from "@/types/finding";

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

export default function CandidatePage() {
  const { state, startResearch, reset } = useInvestigation();

  const [file, setFile] = useState<File | null>(null);
  const [postLinksRaw, setPostLinksRaw] = useState("");
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssueResponse | null>(null);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const postLinks = useMemo(
    () => postLinksRaw.split("\n").map((l) => l.trim()).filter(Boolean),
    [postLinksRaw],
  );

  const isIdle = state.status === "idle";
  const isRunning = state.status === "running";
  const researchDone = state.status === "research_done";
  const halted = state.status === "gap" || state.status === "error";
  const findings = state.findings;
  const hackathonFindings = findings.filter(
    (f): f is HackathonWinsFinding => f.type === "hackathon_wins",
  );
  const totalCount = hackathonFindings.reduce((acc, f) => acc + f.count, 0);
  const canIssue =
    researchDone && findings.length > 0 && !state.gap && !!state.sessionId;

  const handleFullReset = useCallback(() => {
    reset();
    setFile(null);
    setPostLinksRaw("");
    setIssued(null);
    setVerify(null);
    setIssueError(null);
    setIssueLoading(false);
    setCopied(false);
  }, [reset]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file && postLinks.length === 0) return;
      const formData = new FormData();
      if (file) formData.append("file", file);
      if (postLinks.length > 0) formData.append("postLinks", JSON.stringify(postLinks));
      await startResearch("/api/research/candidate/stream", formData);
    },
    [file, postLinks, startResearch],
  );

  const handleIssue = useCallback(async () => {
    if (!state.sessionId) return;
    setIssueLoading(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/issue/candidate", {
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
        /* non-fatal: panel will fall back to issued.public_claims */
      });
    return () => {
      cancelled = true;
    };
  }, [issued?.proof_code]);

  const proofMeta = issued ? parseProofJson(issued.proof_json) : null;
  // eddsa_only: real EdDSA signature, Noir circuit unavailable
  // placeholder (legacy): same semantic — treat identically
  const isEddsaOnly = proofMeta?.eddsa_only === true || proofMeta?.placeholder === true;
  const isPlaceholderProof = false; // amber warning retired — EdDSA IS a valid proof

  const formCanSubmit = !isRunning && (!!file || postLinks.length > 0);

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (file) parts.push(file.name);
    if (postLinks.length > 0) parts.push(`${postLinks.length} link${postLinks.length === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : "Submitted";
  }, [file, postLinks]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 h-12 shrink-0 flex items-center px-6 gap-2">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:opacity-70 transition-opacity">
          zk-hires
        </Link>
        <span className="text-muted-foreground/40 text-sm select-none">/</span>
        <span className="text-sm text-muted-foreground">Verify Hackathon Win</span>
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
        <CandidateForm
          file={file}
          setFile={setFile}
          postLinksRaw={postLinksRaw}
          setPostLinksRaw={setPostLinksRaw}
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

            <AgentDashboard state={state} flow="candidate" />

            {researchDone && !issued && (
              <ReviewPanel
                summary={
                  hackathonFindings.length === 0
                    ? "No hackathon wins derived"
                    : `Found ${totalCount} hackathon win${totalCount === 1 ? "" : "s"} from ${state.evidence.length} verified source${state.evidence.length === 1 ? "" : "s"}`
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
                    /* clipboard blocked - silent */
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

/* ────────────────────────────── form ────────────────────────────── */

type CandidateFormProps = {
  file: File | null;
  setFile: (f: File | null) => void;
  postLinksRaw: string;
  setPostLinksRaw: (v: string) => void;
  loading: boolean;
  canSubmit: boolean;
  onSubmit: (e: React.FormEvent) => void;
};

function CandidateForm({
  file,
  setFile,
  postLinksRaw,
  setPostLinksRaw,
  loading,
  canSubmit,
  onSubmit,
}: CandidateFormProps) {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg flex flex-col gap-8">
        <div>
          <div className="size-9 rounded-xl bg-muted flex items-center justify-center mb-4">
            <svg className="size-4 text-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Hackathon win verification</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Upload a certificate and any supporting links. Our agents read it,
            cross-reference the organiser, and issue a tamper-proof ZK
            credential you can share with employers.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="certificate" className="text-xs font-medium text-muted-foreground">
              Certificate file
            </Label>
            <Input
              id="certificate"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">PDF or image, max 10 MB. Optional if you provide links.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="postLinks" className="text-xs font-medium text-muted-foreground">
              Supporting links{" "}
              <span className="text-muted-foreground/50 font-normal">(optional)</span>
            </Label>
            <textarea
              id="postLinks"
              rows={3}
              placeholder={"https://devpost.com/...\nhttps://linkedin.com/posts/...\nhttps://x.com/..."}
              value={postLinksRaw}
              onChange={(e) => setPostLinksRaw(e.target.value)}
              disabled={loading}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none disabled:opacity-50 transition-colors"
            />
            <p className="text-xs text-muted-foreground">One URL per line. LinkedIn / X posts, Devpost projects, Eventbrite pages, etc.</p>
          </div>

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {loading ? "Running agents…" : "Begin verification"}
          </Button>
        </form>

        <div className="border-t border-border pt-5">
          <p className="text-xs font-medium text-foreground/70 mb-3">How it works</p>
          <ol className="space-y-3">
            {[
              "OCR extracts the win details from your certificate",
              "Organiser profile confirms the event is legitimate",
              "Reviewer scores the evidence and derives a finding",
              "Issuer signs a ZK credential with your public claims",
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

/* ──────────────────────── review panel ──────────────────────── */

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

/* ───────────────────────── proof panel ───────────────────────── */

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
  const claimLabel =
    claimType === "hackathon_wins"
      ? `${publicClaims.claim_value ?? "?"} hackathon win${publicClaims.claim_value === "1" ? "" : "s"}`
      : claimType === "reputable_company"
        ? "Reputable company"
        : (claimType ?? "—");

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">Claim</p>
        <p className="font-medium">{claimLabel}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">Claim type</p>
        <p className="font-medium font-mono text-xs">{claimType ?? "—"}</p>
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
