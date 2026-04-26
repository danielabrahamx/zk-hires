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

type Mode = "link" | "file";

export default function CandidatePage() {
  const [mode, setMode] = useState<Mode>("link");
  const [file, setFile] = useState<File | null>(null);
  const [postLinksRaw, setPostLinksRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setResult(null);
    setSteps([]);
  }

  const postLinks = postLinksRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const canSubmit =
    !loading &&
    (mode === "link" ? postLinks.length > 0 : file !== null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setSteps([]);
    setResult(null);

    try {
      const formData = new FormData();
      if (mode === "file" && file) {
        formData.append("file", file);
        if (postLinks.length > 0) {
          formData.append("postLinks", JSON.stringify(postLinks));
        }
      } else {
        formData.append("postLinks", JSON.stringify(postLinks));
      }

      const response = await fetch("/api/issue/candidate", {
        method: "POST",
        body: formData,
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
            Verify a Hackathon Win
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Prove your win with a social post or a certificate - either works.
          </p>
        </div>

        {/* Mode switcher */}
        <div className="flex rounded-full border border-border bg-muted p-1 gap-1">
          <button
            type="button"
            onClick={() => switchMode("link")}
            className={`flex-1 text-sm py-1.5 rounded-full transition-colors ${
              mode === "link"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Social post / link
          </button>
          <button
            type="button"
            onClick={() => switchMode("file")}
            className={`flex-1 text-sm py-1.5 rounded-full transition-colors ${
              mode === "file"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Certificate file
          </button>
        </div>

        <Card>
          {mode === "link" ? (
            <>
              <CardHeader>
                <CardTitle>Paste post links</CardTitle>
                <CardDescription>
                  AI agents fetch and verify the content. LinkedIn posts, X threads,
                  Devpost pages, and organiser announcements all work. Social posts
                  are harder to fake than certificates.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="postLinks">Post or announcement URLs</Label>
                    <textarea
                      id="postLinks"
                      rows={3}
                      placeholder={"https://linkedin.com/posts/...\nhttps://x.com/...\nhttps://devpost.com/..."}
                      value={postLinksRaw}
                      onChange={(e) => setPostLinksRaw(e.target.value)}
                      disabled={loading}
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none disabled:opacity-50"
                    />
                    <p className="text-xs text-zinc-500">One URL per line.</p>
                  </div>
                  <Button type="submit" disabled={!canSubmit} className="w-full">
                    {loading ? "Verifying..." : "Generate Credential"}
                  </Button>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Upload Certificate</CardTitle>
                <CardDescription>
                  PDF or image, max 10 MB. Optionally add post links below to
                  strengthen the evidence.
                </CardDescription>
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
                  <div className="space-y-2">
                    <Label htmlFor="postLinksCert">
                      Supporting links{" "}
                      <span className="text-zinc-400 font-normal">(optional)</span>
                    </Label>
                    <textarea
                      id="postLinksCert"
                      rows={2}
                      placeholder={"https://devpost.com/...\nhttps://linkedin.com/..."}
                      value={postLinksRaw}
                      onChange={(e) => setPostLinksRaw(e.target.value)}
                      disabled={loading}
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none disabled:opacity-50"
                    />
                  </div>
                  <Button type="submit" disabled={!canSubmit} className="w-full">
                    {loading ? "Processing..." : "Generate Credential"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
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
