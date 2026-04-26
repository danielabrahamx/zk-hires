"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  decodeEmployerClaimValue,
  type FundingBracket,
} from "@/config/runtime";

type CredentialData = {
  claim_type?: string;
  claim_value?: string;
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

function bracketLabelFor(value: string | undefined): string | null {
  if (!value) return null;
  if (value in BRACKET_LABEL) return BRACKET_LABEL[value as FundingBracket];
  try {
    const decoded = decodeEmployerClaimValue(BigInt(value));
    if (decoded) return BRACKET_LABEL[decoded];
  } catch {
    /* not a numeric encoding */
  }
  return null;
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function VerifyPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;

  const [data, setData] = useState<CredentialData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    fetch(`/api/verify/${code}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (!r.ok) {
          const body = (await r.json()) as { error?: string };
          setError(body.error ?? "Lookup failed");
          return;
        }
        const body = (await r.json()) as CredentialData;
        setData(body);
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, [code]);

  const nowSecs = Date.now() / 1000;
  const isExpired = data ? nowSecs > data.expires_at : false;

  const claimType = data?.claim_type ?? data?.public_claims.claim_type;

  const claimLabel =
    claimType === "hackathon_wins"
      ? "Hackathon Win"
      : claimType === "reputable_company"
        ? "Reputable Company"
        : (claimType ?? "Credential");

  const isEmployer = claimType === "reputable_company";

  const fundingBracket = isEmployer
    ? bracketLabelFor(data?.public_claims.bracket_at_least ?? data?.claim_value)
    : null;

  const jurisdiction = isEmployer ? data?.public_claims.jurisdiction : null;

  const hackathonCount =
    claimType === "hackathon_wins"
      ? (data?.claim_value ?? data?.public_claims.claim_value)
      : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-tight hover:opacity-70 transition-opacity">
            zk-hires
          </Link>
          <span className="text-xs text-muted-foreground hidden sm:block">Verify credential</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg space-y-6">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </Link>
            <h1 className="text-3xl font-light tracking-tight">Verify Credential</h1>
            <p className="font-mono text-sm text-muted-foreground mt-1">{code}</p>
          </div>

          {loading && (
            <p className="text-sm text-muted-foreground animate-pulse">
              Looking up credential&hellip;
            </p>
          )}

          {!loading && notFound && (
            <Alert variant="destructive">
              <AlertTitle>Not found</AlertTitle>
              <AlertDescription>
                No credential found for code <strong>{code}</strong>. Check the code and try again.
              </AlertDescription>
            </Alert>
          )}

          {!loading && error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!loading && data && (
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden motion-fade-up">
              <div className="px-6 py-5 border-b border-border/60 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Claim type</p>
                  <h2 className="text-lg font-semibold tracking-tight">{claimLabel}</h2>
                </div>
                <Badge variant={isExpired ? "destructive" : "default"} className="shrink-0">
                  {isExpired ? "Expired" : "Valid"}
                </Badge>
              </div>

              <div className="px-6 py-5">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  {hackathonCount && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Wins verified</p>
                      <p className="font-semibold text-base">{hackathonCount}</p>
                    </div>
                  )}
                  {fundingBracket && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Funding bracket</p>
                      <p className="font-medium">{fundingBracket}</p>
                    </div>
                  )}
                  {jurisdiction && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Jurisdiction</p>
                      <p className="font-medium uppercase">{jurisdiction}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Issued</p>
                    <p className="font-medium">{formatDate(data.issued_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Expires</p>
                    <p className="font-medium">{formatDate(data.expires_at)}</p>
                  </div>
                </div>

                {data.public_claims.issuer_pubkey && (
                  <div className="mt-5 pt-5 border-t border-border/60">
                    <p className="text-xs text-muted-foreground mb-1">Issuer public key</p>
                    <p className="text-xs font-mono text-muted-foreground break-all">
                      {data.public_claims.issuer_pubkey}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
