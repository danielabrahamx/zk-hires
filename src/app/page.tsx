import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/50 px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">zk-hires</span>
          <span className="text-xs text-muted-foreground hidden sm:block">
            Zero-knowledge credentials for hiring
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl mx-auto text-center space-y-8">

          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
            ZK Credentials &middot; Built for Hiring
          </div>

          <div className="space-y-3">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1]">
              Prove what matters.{" "}
              <span className="text-foreground/40">Reveal nothing else.</span>
            </h1>
            <p className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
              ZK credentials for hiring. Candidates prove hackathon wins.
              Employers prove company legitimacy. No documents shared.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-4">
              <div className="size-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <svg className="size-4 text-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold">I&apos;m a candidate</h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Upload a hackathon certificate and receive a proof code to share with employers.
                </p>
              </div>
              <Link
                href="/candidate"
                className={cn(buttonVariants({ variant: "default" }), "w-full justify-center mt-auto")}
              >
                Verify a win
              </Link>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-4">
              <div className="size-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <svg className="size-4 text-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold">I&apos;m an employer</h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Enter your Companies House number and website to get a legitimacy credential.
                </p>
              </div>
              <Link
                href="/employer"
                className={cn(buttonVariants({ variant: "default" }), "w-full justify-center mt-auto")}
              >
                Verify company
              </Link>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Have a proof code?{" "}
            <code className="text-xs bg-muted text-foreground/60 px-1.5 py-0.5 rounded font-mono">
              /verify/ZKH-XXXX-XXXX
            </code>
          </p>

        </div>
      </main>
    </div>
  );
}
