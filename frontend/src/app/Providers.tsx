import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { AnalysisAutoRun } from "@/ai/AnalysisAutoRun";
import { startHashSync } from "@/state/nav";
import { useSettings } from "@/state/settings";

/**
 * Applies the theme and calm settings to <html>, provides data caching,
 * keeps the URL hash in step with the screen (deep links and Back), and
 * starts on-use story analysis in the test link.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchInterval: 60_000, // live data polls every minute
            refetchOnWindowFocus: false,
            retry: (count, error) => count < 1 && (error as { retryable?: boolean }).retryable === true,
          },
        },
      }),
  );
  const theme = useSettings((s) => s.theme);
  const calm = useSettings((s) => s.calm);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const hostTheme = root.getAttribute("data-theme"); // set by the claude.ai viewer
      const system =
        hostTheme === "light" || hostTheme === "dark"
          ? hostTheme
          : window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
      root.setAttribute("data-wg-theme", theme === "system" ? system : theme);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", apply);
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", apply);
      observer.disconnect();
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-wg-calm", String(calm));
  }, [calm]);

  useEffect(() => startHashSync(), []);

  return (
    <QueryClientProvider client={client}>
      {children}
      <AnalysisAutoRun />
    </QueryClientProvider>
  );
}
