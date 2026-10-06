import { ArrowLeft, X } from "lucide-react";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { Drawer } from "vaul";

import { PANEL_COMPONENTS, WIDE_PANELS } from "./registry";
import { useIsDesktop } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { currentPanel, useNav, type Panel } from "@/state/nav";

function PanelContent({ panel }: { panel: Panel }) {
  const Component = PANEL_COMPONENTS[panel.kind] as React.ComponentType<{ panel: Panel }>;
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Component panel={panel} />
    </Suspense>
  );
}

export function PanelSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

function Controls({ depth, children }: { depth: number; children?: ReactNode }) {
  const back = useNav((s) => s.back);
  const closePanels = useNav((s) => s.closePanels);
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-glass px-2 py-1.5 backdrop-blur">
      {depth > 1 && (
        <button
          type="button"
          onClick={back}
          className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Back"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={closePanels}
        className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Close panel"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/**
 * Shows the top panel: a floating side panel on desktop (full width for the
 * cascade), a bottom sheet with two heights on phones.
 */
export function PanelHost() {
  const panel = useNav(currentPanel);
  const depth = useNav((s) => s.panels.length);
  const closePanels = useNav((s) => s.closePanels);
  const isDesktop = useIsDesktop();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [panel]);

  if (isDesktop) {
    if (!panel) return null;
    const wide = WIDE_PANELS.has(panel.kind);
    return (
      <aside
        aria-label="Details"
        className={cn(
          "absolute z-20 flex flex-col overflow-hidden rounded-xl border border-line bg-glass shadow-panel backdrop-blur-xl",
          wide ? "inset-3" : "top-3 right-3 bottom-3 w-[min(440px,calc(100%-24px))]",
        )}
      >
        <Controls depth={depth} />
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <PanelContent panel={panel} />
        </div>
      </aside>
    );
  }

  return (
    <Drawer.Root
      open={panel !== null}
      onOpenChange={(open) => !open && closePanels()}
      snapPoints={[0.5, 0.94]}
      modal={false}
    >
      <Drawer.Portal>
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-40 flex h-[94dvh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-panel outline-none"
        >
          <Drawer.Title className="sr-only">Details</Drawer.Title>
          <div className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
          <Controls depth={depth} />
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]"
          >
            {panel && <PanelContent panel={panel} />}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
