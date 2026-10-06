import { CircleDot, Database, TriangleAlert } from "lucide-react";

import { useConnection } from "@/api/client";
import { useRpc } from "@/api/client";
import { cn } from "@/lib/utils";

/** One quiet line: where the data comes from and how fresh it is. */
export function StatusBar() {
  const state = useConnection((s) => s.state);
  const meta = useRpc("meta", {});
  const showingSample = meta.data?.data.showing_sample ?? false;

  let label = "Connecting…";
  let tone: "ok" | "warn" | "muted" = "muted";
  if (state.status === "live") {
    label = showingSample ? "Sample data" : "Live data";
    tone = showingSample ? "muted" : "ok";
  } else if (state.status === "snapshot") {
    label = "Sample snapshot — " + state.reason.message;
    tone = "warn";
  } else if (state.status === "error") {
    label = state.reason.message;
    tone = "warn";
  }

  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] left-3 z-10 flex max-w-[calc(100%-24px)] items-center gap-1.5 truncate rounded-full border border-line bg-glass px-2.5 py-1 text-label text-fg-muted backdrop-blur md:bottom-3"
    >
      {tone === "warn" ? (
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-risk" />
      ) : tone === "ok" ? (
        <CircleDot aria-hidden className={cn("size-3.5 shrink-0 text-opportunity")} />
      ) : (
        <Database aria-hidden className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}
