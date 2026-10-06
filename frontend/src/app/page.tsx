import { Globe2 } from "lucide-react";

import { SetupCheck } from "@/components/setup-check";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Globe2 aria-hidden className="size-5" />
          WorldGraph
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
            Sample data
          </span>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[12vh] pb-16 sm:px-6">
        <SetupCheck />
      </main>
    </div>
  );
}
