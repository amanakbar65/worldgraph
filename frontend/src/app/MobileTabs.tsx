import { MoreHorizontal } from "lucide-react";

import { NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";

/** Bottom tab bar on phones: four main screens plus "More". */
export function MobileTabs() {
  const view = useNav((s) => s.view);
  const setView = useNav((s) => s.setView);
  const moreOpen = useUi((s) => s.moreOpen);
  const setMoreOpen = useUi((s) => s.setMoreOpen);
  const extra = NAV_ITEMS.filter((i) => !i.mobile);

  return (
    <nav
      aria-label="Screens"
      className="relative z-30 grid shrink-0 grid-cols-5 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden"
    >
      {NAV_ITEMS.filter((i) => i.mobile).map((item) => (
        <button
          key={item.view}
          type="button"
          onClick={() => {
            setView(item.view);
            setMoreOpen(false);
          }}
          aria-current={view === item.view ? "page" : undefined}
          className={cn(
            "flex h-14 flex-col items-center justify-center gap-0.5 text-label text-fg-subtle",
            view === item.view && "text-fg",
          )}
        >
          <item.icon aria-hidden className="size-5" />
          {item.label.replace("My ", "")}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setMoreOpen(!moreOpen)}
        aria-expanded={moreOpen}
        className={cn(
          "flex h-14 flex-col items-center justify-center gap-0.5 text-label text-fg-subtle",
          extra.some((i) => i.view === view) && "text-fg",
        )}
      >
        <MoreHorizontal aria-hidden className="size-5" />
        More
      </button>
      {moreOpen && (
        <div className="absolute right-2 bottom-full mb-2 w-48 overflow-hidden rounded-lg border border-line bg-surface shadow-panel">
          {extra.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => {
                setView(item.view);
                setMoreOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-3 text-left text-body hover:bg-surface-2"
            >
              <item.icon aria-hidden className="size-4" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
