import { MessageCircleQuestion, Search, Settings2 } from "lucide-react";

import { NAV_ITEMS } from "./nav-items";
import { StatusBar } from "./StatusBar";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { useUi } from "@/state/ui";

export function Header() {
  const view = useNav((s) => s.view);
  const setView = useNav((s) => s.setView);
  const open = useNav((s) => s.open);
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  const requestHome = useUi((s) => s.requestHome);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        // Phones have no globe Home control, so the logo is Home everywhere:
        // back to the globe, fly to the home view and start the slow turn.
        onClick={() => {
          setView("globe");
          requestHome();
        }}
        // The ::before layers on the header's buttons make each tap area 40 px.
        className="relative flex items-center gap-2 rounded-md px-1 py-1 text-body font-semibold tracking-tight before:absolute before:-inset-1 before:content-['']"
        aria-label="WorldGraph home"
      >
        <Logo className="size-6" />
        <span className="hidden sm:inline">WorldGraph</span>
      </button>

      {/* Icons only until there is room for every label (xl), so search, Ask and Settings stay on screen. */}
      <nav aria-label="Screens" className="ml-2 hidden items-center gap-0.5 md:flex">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => setView(item.view)}
            aria-current={view === item.view ? "page" : undefined}
            title={item.label}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body whitespace-nowrap text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
              view === item.view && "bg-surface-2 text-fg",
            )}
          >
            <item.icon aria-hidden className="size-4" />
            <span className="sr-only xl:not-sr-only">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Phones, and every screen but the globe: the data status lives here rather than over the content. */}
      <StatusBar placement="header" />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="relative flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-body text-fg-muted transition-colors before:absolute before:-inset-0.5 before:content-[''] hover:border-line-strong hover:text-fg sm:w-56 md:w-44 lg:w-56"
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
          className="relative flex h-9 items-center gap-1.5 rounded-md px-2.5 text-body text-fg-muted transition-colors before:absolute before:-inset-0.5 before:content-[''] hover:bg-surface-2 hover:text-fg"
        >
          <MessageCircleQuestion aria-hidden className="size-4" />
          <span className="hidden lg:inline">Ask</span>
          <span className="sr-only lg:hidden">Ask a question</span>
        </button>
        <button
          type="button"
          onClick={() => open({ kind: "settings" })}
          className="relative flex size-9 items-center justify-center rounded-md text-fg-muted transition-colors before:absolute before:-inset-0.5 before:content-[''] hover:bg-surface-2 hover:text-fg"
          aria-label="Settings"
        >
          <Settings2 aria-hidden className="size-4" />
        </button>
      </div>
    </header>
  );
}
