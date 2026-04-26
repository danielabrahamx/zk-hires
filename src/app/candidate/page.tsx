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

export default function CandidatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/issue/candidate", {
        method: "POST",
        body: formData,
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
            Verify a Hackathon Win
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Upload your certificate to receive a zero-knowledge credential.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload Certificate</CardTitle>
            <CardDescription>PDF or image, max 10 MB.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="certificate">Certificate file</Label>
                <Input
                  id="certificate"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                disabled={!file || loading}
                className="w-full"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="motion-spin inline-block size-3.5 rounded-full border-2 border-current border-t-transparent" />
                    Processing&hellip;
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
                <Badge variant="secondary">
                  hackathon wins: {result.public_claims.claim_value}
                </Badge>
              </div>
              <p className="text-sm text-zinc-500">
                Share this code with employers. They can verify at{" "}
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
                Try uploading a clearer certificate from a recognised organiser.
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
