import { MessageCircleQuestion, Search, Settings2 } from "lucide-react";

import { NAV_ITEMS } from "./nav-items";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";

export function Header() {
  const view = useNav((s) => s.view);
  const setView = useNav((s) => s.setView);
  const open = useNav((s) => s.open);
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        onClick={() => setView("globe")}
        className="flex items-center gap-2 rounded-md px-1 py-1 text-body font-semibold tracking-tight"
        aria-label="WorldGraph home"
      >
        <Logo className="size-6" />
        <span className="hidden sm:inline">WorldGraph</span>
      </button>

      <nav aria-label="Screens" className="ml-2 hidden items-center gap-0.5 md:flex">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => setView(item.view)}
            aria-current={view === item.view ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
              view === item.view && "bg-surface-2 text-fg",
            )}
          >
            <item.icon aria-hidden className="size-4" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-body text-fg-muted transition-colors hover:border-line-strong hover:text-fg sm:w-56"
          aria-label="Search places, companies, stories and forecasts"
        >
          <Search aria-hidden className="size-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-auto hidden rounded border border-line px-1.5 font-mono text-label text-fg-subtle sm:inline">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => open({ kind: "ask" })}
          className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-body text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <MessageCircleQuestion aria-hidden className="size-4" />
          <span className="hidden lg:inline">Ask</span>
          <span className="sr-only lg:hidden">Ask a question</span>
        </button>
        <button
          type="button"
          onClick={() => open({ kind: "settings" })}
          className="flex size-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Settings"
        >
          <Settings2 aria-hidden className="size-4" />
        </button>
      </div>
    </header>
  );
}
