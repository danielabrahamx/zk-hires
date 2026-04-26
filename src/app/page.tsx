import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-white dark:bg-zinc-900 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight">zk-hires</h1>
          <span className="text-xs text-zinc-400">
            Zero-knowledge credentials for hiring
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-10">
          <div className="text-center space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight">
              Prove what matters. Reveal nothing else.
            </h2>
            <p className="text-zinc-500 max-w-md mx-auto text-sm leading-relaxed">
              ZK credentials for hiring. Candidates prove hackathon wins.
              Employers prove company legitimacy. No documents shared.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="motion-fade-up hover:-translate-y-0.5 transition-[transform,box-shadow] duration-200 hover:shadow-md">
              <CardHeader>
                <CardTitle>I&apos;m a candidate</CardTitle>
                <CardDescription>
                  Upload a hackathon certificate and receive a proof code to
                  share with employers.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href="/candidate"
                  className={cn(buttonVariants({ variant: "default" }), "w-full justify-center")}
                >
                  Verify a win &rarr;
                </Link>
              </CardContent>
            </Card>

            <Card className="motion-fade-up motion-delay-1 hover:-translate-y-0.5 transition-[transform,box-shadow] duration-200 hover:shadow-md">
              <CardHeader>
                <CardTitle>I&apos;m an employer</CardTitle>
                <CardDescription>
                  Enter your Companies House number and website to get a
                  legitimacy credential.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href="/employer"
                  className={cn(buttonVariants({ variant: "default" }), "w-full justify-center")}
                >
                  Verify company &rarr;
                </Link>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-sm text-zinc-400">
            Have a proof code? Visit{" "}
            <code className="text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-xs">
              /verify/ZKH-XXXX-XXXX
            </code>
          </p>
        </div>
      </main>
    </div>
  );
}
