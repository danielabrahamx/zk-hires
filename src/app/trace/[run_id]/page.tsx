import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEventsByRunId } from "@/trace/store";

type Props = { params: Promise<{ run_id: string }> };

export default async function TracePage({ params }: Props) {
  const { run_id } = await params;
  const events = getEventsByRunId(run_id);

  if (events.length === 0) notFound();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            &larr; Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Trace Viewer
          </h1>
          <p className="font-mono text-xs text-zinc-400 mt-1 break-all">
            {run_id}
          </p>
        </div>

        <div className="space-y-3">
          {events.map((event, i) => {
            const ts = new Date(event.ts);
            const prev = events[i - 1];
            const gap = prev ? event.ts - prev.ts : 0;

            return (
              <Card key={event.id ?? i} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize text-xs">
                        {event.agent}
                      </Badge>
                      <CardTitle className="text-sm font-medium">
                        {event.action}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {event.error && (
                        <Badge variant="destructive" className="text-xs">
                          error
                        </Badge>
                      )}
                      <span className="text-xs text-zinc-400 tabular-nums">
                        {event.latency_ms}ms
                      </span>
                    </div>
                  </div>
                  <CardDescription className="text-xs tabular-nums">
                    {ts.toISOString()}
                    {gap > 0 && (
                      <span className="ml-2 text-zinc-300">
                        (+{gap}ms from prev)
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  {event.evidence_ids.length > 0 && (
                    <div>
                      <p className="text-xs text-zinc-400 mb-1">Evidence IDs</p>
                      <div className="flex flex-wrap gap-1">
                        {event.evidence_ids.map((id) => (
                          <code
                            key={id}
                            className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono"
                          >
                            {id.slice(0, 8)}&hellip;
                          </code>
                        ))}
                      </div>
                    </div>
                  )}

                  <details className="group">
                    <summary className="text-xs text-zinc-400 cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300">
                      Input / Output
                    </summary>
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">
                          Input
                        </p>
                        <pre className="text-[10px] bg-zinc-100 dark:bg-zinc-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(event.input, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">
                          Output
                        </p>
                        <pre className="text-[10px] bg-zinc-100 dark:bg-zinc-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(event.output, null, 2)}
                        </pre>
                      </div>
                      {event.error && (
                        <div>
                          <p className="text-[10px] text-red-500 uppercase tracking-wide mb-1">
                            Error
                          </p>
                          <pre className="text-[10px] bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                            {event.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
