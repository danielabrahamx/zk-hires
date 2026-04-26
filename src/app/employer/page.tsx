"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type Result =
  | {
      type: "success";
      proof_code: string;
      public_claims: Record<string, string>;
    }
  | {
      type: "gap";
      reason: string;
      missing_evidence: string[];
    }
  | { type: "error"; message: string };

export default function EmployerPage() {
  const [companyNumber, setCompanyNumber] = useState("");
  const [supplementaryUrl, setSupplementaryUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyNumber.trim() || !supplementaryUrl.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/issue/employer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyNumber: companyNumber.trim(),
          supplementaryUrl: supplementaryUrl.trim(),
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        gap?: { reason: string; missing_evidence: string[] };
        proof_code?: string;
        public_claims?: Record<string, string>;
      };

      if (!response.ok) {
        setResult({ type: "error", message: data.error ?? "Unexpected error" });
        return;
      }
      if (data.gap) {
        setResult({
          type: "gap",
          reason: data.gap.reason,
          missing_evidence: data.gap.missing_evidence,
        });
        return;
      }
      setResult({
        type: "success",
        proof_code: data.proof_code!,
        public_claims: data.public_claims!,
      });
    } catch {
      setResult({ type: "error", message: "Network error - please try again" });
    } finally {
      setLoading(false);
    }
  }

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
            Verify Your Company
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Enter your Companies House number and a supporting URL to receive a
            ZK legitimacy credential.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Company Details</CardTitle>
            <CardDescription>
              We look up your company via Companies House and analyse the URL
              you provide for legitimacy signals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="companyNumber">Companies House number</Label>
                <Input
                  id="companyNumber"
                  type="text"
                  placeholder="12345678"
                  value={companyNumber}
                  onChange={(e) => setCompanyNumber(e.target.value)}
                  disabled={loading}
                  maxLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplementaryUrl">Supporting URL</Label>
                <Input
                  id="supplementaryUrl"
                  type="url"
                  placeholder="https://yourcompany.com"
                  value={supplementaryUrl}
                  onChange={(e) => setSupplementaryUrl(e.target.value)}
                  disabled={loading}
                />
                <p className="text-xs text-zinc-500">
                  Your website, a news article, LinkedIn page, or Crunchbase
                  profile.
                </p>
              </div>
              <Button
                type="submit"
                disabled={
                  !companyNumber.trim() ||
                  !supplementaryUrl.trim() ||
                  loading
                }
                className="w-full"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="motion-spin inline-block size-3.5 rounded-full border-2 border-current border-t-transparent" />
                    Verifying&hellip;
                  </span>
                ) : (
                  "Generate Credential"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {result?.type === "success" && (
          <Card className="motion-fade-up border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
            <CardHeader>
              <CardTitle className="text-green-800 dark:text-green-200">
                Credential Issued
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-zinc-500 mb-1">Your proof code</p>
                <div className="flex items-center gap-2">
                  <code className="text-xl font-mono font-bold tracking-widest">
                    {result.proof_code}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigator.clipboard.writeText(result.proof_code)
                    }
                  >
                    Copy
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="secondary">reputable company</Badge>
                <Badge variant="secondary">UK jurisdiction</Badge>
              </div>
              <p className="text-sm text-zinc-500">
                Share this code with candidates. They can verify at{" "}
                <Link
                  href={`/verify/${result.proof_code}`}
                  className="underline"
                >
                  /verify/{result.proof_code}
                </Link>
              </p>
            </CardContent>
          </Card>
        )}

        {result?.type === "gap" && (
          <Alert className="motion-fade-up">
            <AlertTitle>Could not issue credential</AlertTitle>
            <AlertDescription>
              <p>{result.reason}</p>
              {result.missing_evidence.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-sm">
                  {result.missing_evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-sm text-zinc-500">
                Try a URL with clearer company size or funding information.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {result?.type === "error" && (
          <Alert variant="destructive" className="motion-fade-up">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
