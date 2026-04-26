"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type CredentialData = {
  public_claims: Record<string, string>;
  issued_at: number;
  expires_at: number;
};

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

  const claimLabel =
    data?.public_claims.claim_type === "hackathon_wins"
      ? "Hackathon Win"
      : data?.public_claims.claim_type === "reputable_company"
        ? "Reputable Company"
        : data?.public_claims.claim_type;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <div>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            &larr; Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Verify Credential
          </h1>
          <p className="font-mono text-sm text-zinc-400 mt-1">{code}</p>
        </div>

        {loading && (
          <p className="text-sm text-zinc-400 animate-pulse">
            Looking up credential&hellip;
          </p>
        )}

        {!loading && notFound && (
          <Alert variant="destructive">
            <AlertTitle>Not found</AlertTitle>
            <AlertDescription>
              No credential found for code <strong>{code}</strong>. Check the
              code and try again.
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
          <Card className="motion-fade-up">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{claimLabel}</CardTitle>
                <Badge variant={isExpired ? "destructive" : "default"}>
                  {isExpired ? "Expired" : "Valid"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-zinc-500">Claim type</p>
                  <p className="font-medium">{data.public_claims.claim_type}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Claim value</p>
                  <p className="font-medium">{data.public_claims.claim_value}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Issued</p>
                  <p className="font-medium">
                    {new Date(data.issued_at * 1000).toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Expires</p>
                  <p className="font-medium">
                    {new Date(data.expires_at * 1000).toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short", year: "numeric" }
                    )}
                  </p>
                </div>
              </div>
              <div className="pt-3 border-t">
                <p className="text-xs text-zinc-400 mb-1">Issuer public key</p>
                <p className="text-xs font-mono text-zinc-500 break-all">
                  {data.public_claims.issuer_pubkey}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
