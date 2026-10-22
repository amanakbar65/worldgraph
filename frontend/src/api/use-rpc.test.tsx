import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dataSource, useRpc, withViewerArgs } from "./client";
import { useSettings } from "@/state/settings";

const auto = { sample: undefined, india: false };

describe("withViewerArgs", () => {
  it("adds the Sample data setting to every read that takes it", () => {
    for (const sample of [true, false]) {
      expect(withViewerArgs("entity", { id: "org:dp-world" }, { ...auto, sample })).toEqual({
        id: "org:dp-world",
        sample,
      });
      expect(withViewerArgs("story", { id: "story:x" }, { ...auto, sample })).toEqual({
        id: "story:x",
        sample,
      });
      expect(withViewerArgs("cascade", { id: "story:x", depth: 2 }, { ...auto, sample })).toEqual({
        id: "story:x",
        depth: 2,
        sample,
      });
      expect(withViewerArgs("local_graph", { id: "region:in", depth: 1 }, { ...auto, sample })).toEqual({
        id: "region:in",
        depth: 1,
        sample,
      });
      expect(withViewerArgs("search", { q: "oil" }, { ...auto, sample })).toEqual({ q: "oil", sample });
      expect(withViewerArgs("forecast", { id: "forecast:x" }, { ...auto, sample })).toEqual({
        id: "forecast:x",
        sample,
      });
    }
  });

  it("leaves the argument out on auto, so the database decides", () => {
    expect(withViewerArgs("entity", { id: "org:dp-world" }, auto)).toEqual({ id: "org:dp-world" });
  });

  it("keeps what the screen chose", () => {
    expect(withViewerArgs("globe", { window: "24h", sample: true }, { ...auto, sample: false })).toEqual({
      window: "24h",
      sample: true,
    });
  });

  it("never sends sample to meta or to the analysis writers", () => {
    expect(withViewerArgs("meta", {}, { ...auto, sample: true })).toEqual({});
    expect(withViewerArgs("pending_analysis", { limit: 6 }, { ...auto, sample: true })).toEqual({ limit: 6 });
  });

  it("asks search and region for India's view when the viewer sees India's borders", () => {
    const india = { sample: undefined, india: true };
    expect(withViewerArgs("search", { q: "Kashmir" }, india)).toEqual({ q: "Kashmir", worldview: "india" });
    expect(withViewerArgs("region", { id: "region:pk-jk", window: "7d" }, india)).toEqual({
      id: "region:pk-jk",
      window: "7d",
      worldview: "india",
    });
    expect(withViewerArgs("story", { id: "story:x" }, india)).toEqual({ id: "story:x" });
    expect(withViewerArgs("search", { q: "Kashmir" }, auto)).toEqual({ q: "Kashmir" });
  });
});

describe("useRpc", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useSettings.setState({ sample: "auto", borders: "auto" });
  });

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("sends the viewer's Sample data setting and worldview with detail panels and search", async () => {
    const call = vi.spyOn(dataSource, "call").mockResolvedValue({ results: [] } as never);
    useSettings.setState({ sample: "on", borders: "india" });
    const search = renderHook(() => useRpc("search", { q: "Kashmir", limit: 8 }), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(call.mock.calls[0][0]).toBe("search");
    expect(call.mock.calls[0][1]).toEqual({ q: "Kashmir", limit: 8, sample: true, worldview: "india" });
    search.unmount();

    useSettings.setState({ sample: "off", borders: "international" });
    renderHook(() => useRpc("entity", { id: "org:dp-world" }), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[1][1]).toEqual({ id: "org:dp-world", sample: false });
  });

  it("asks again when the viewer changes the setting", async () => {
    const call = vi.spyOn(dataSource, "call").mockResolvedValue({} as never);
    renderHook(() => useRpc("story", { id: "story:x" }), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[0][1]).toEqual({ id: "story:x" });
    useSettings.setState({ sample: "on" });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[1][1]).toEqual({ id: "story:x", sample: true });
  });
});
