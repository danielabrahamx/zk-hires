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
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyNumber.trim() && !supplementaryUrl.trim()) return;
    setLoading(true);
    setSteps([]);
    setResult(null);

    try {
      const response = await fetch("/api/issue/employer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyNumber: companyNumber.trim() || undefined,
          supplementaryUrl: supplementaryUrl.trim() || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json()) as { error?: string };
        setResult({ type: "error", message: data.error ?? "Unexpected error" });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line) as {
              type: string;
              label?: string;
              reason?: string;
              missing_evidence?: string[];
              proof_code?: string;
              public_claims?: Record<string, string>;
              message?: string;
            };
            if (event.type === "step" && event.label) {
              setSteps((prev) => [...prev, event.label!]);
            } else if (event.type === "gap") {
              setResult({
                type: "gap",
                reason: event.reason ?? "Insufficient evidence",
                missing_evidence: event.missing_evidence ?? [],
              });
            } else if (event.type === "result") {
              setResult({
                type: "success",
                proof_code: event.proof_code!,
                public_claims: event.public_claims!,
              });
            } else if (event.type === "error") {
              setResult({ type: "error", message: event.message ?? "Unknown error" });
            }
          } catch {
            // ignore malformed SSE frames
          }
        }
      }
    } catch {
      setResult({ type: "error", message: "Network error - please try again" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <div>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="mt-2 text-2xl tracking-tight">
            Verify Your Company
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your Companies House number, a supporting URL, or both to
            receive a ZK legitimacy credential.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Company Details</CardTitle>
            <CardDescription>
              Provide one or both. The agents will analyse whatever you give
              them - Companies House registry data, or any URL (website, news
              article, LinkedIn) as a legitimacy signal.
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
                <p className="text-xs text-muted-foreground">
                  Your website, a news article, LinkedIn page, or Crunchbase
                  profile.
                </p>
              </div>
              <Button
                type="submit"
                disabled={
                  (!companyNumber.trim() && !supplementaryUrl.trim()) || loading
                }
                className="w-full"
              >
                {loading ? "Verifying..." : "Generate Credential"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {steps.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 space-y-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Agent trace</p>
            {steps.map((label, i) => {
              const isDone = !loading || i < steps.length - 1;
              return (
                <div key={i} className="flex items-center gap-2.5 text-sm">
                  {isDone ? (
                    <span className="text-green-400 font-bold leading-none shrink-0">✓</span>
                  ) : (
                    <span className="inline-block size-3 shrink-0 rounded-full border-2 border-zinc-500 border-t-transparent animate-spin" />
                  )}
                  <span className={isDone ? "text-zinc-400" : "text-zinc-100 font-medium"}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {result?.type === "success" && (
          <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
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
          <Alert>
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
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
