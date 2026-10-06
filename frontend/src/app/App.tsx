import { Suspense, useEffect } from "react";

import { Header } from "./Header";
import { MobileTabs } from "./MobileTabs";
import { PanelHost } from "./PanelHost";
import { StatusBar } from "./StatusBar";
import { VIEW_COMPONENTS } from "./registry";
import { CommandSearch } from "@/features/search/CommandSearch";
import { useNav } from "@/state/nav";

export function App() {
  const view = useNav((s) => s.view);
  const View = VIEW_COMPONENTS[view];

  // Escape closes the top panel; Alt+← goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=dialog][data-modal]")) return;
      if (e.key === "Escape") useNav.getState().back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="relative min-h-0 flex-1" tabIndex={-1}>
        <Suspense fallback={<div className="h-full animate-pulse bg-bg-sunken" aria-busy="true" />}>
          <View />
        </Suspense>
        <PanelHost />
      </main>
      <StatusBar />
      <MobileTabs />
      <CommandSearch />
    </div>
  );
}
