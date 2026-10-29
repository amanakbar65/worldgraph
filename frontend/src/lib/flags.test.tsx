import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FLAG_KEYS, flagOn, useFlag } from "./flags";
import { dataSource } from "@/api/client";

describe("flagOn", () => {
  it("is on only when meta says so", () => {
    expect(flagOn({ flags: { "kg.properties": true } }, "kg.properties")).toBe(true);
    expect(flagOn({ flags: { "kg.properties": false } }, "kg.properties")).toBe(false);
  });

  it("is off when the flag or the flags are missing (snapshot, older database)", () => {
    expect(flagOn({ flags: { "kg.properties": true } }, "kg.relations")).toBe(false);
    expect(flagOn({}, "kg.properties")).toBe(false);
    expect(flagOn(undefined, "kg.properties")).toBe(false);
  });

  it("knows the Phase A flags", () => {
    expect(FLAG_KEYS).toEqual([
      "kg.properties",
      "kg.relations",
      "kg.provenance",
      "kg.history",
      "kg.schema_map",
    ]);
  });
});

describe("useFlag", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it("reads api.meta's flags, off until the answer arrives", async () => {
    const call = vi
      .spyOn(dataSource, "call")
      .mockResolvedValue({ flags: { "kg.relations": true, "kg.properties": false } } as never);
    const relations = renderHook(() => useFlag("kg.relations"), { wrapper });
    expect(relations.result.current).toBe(false);
    await waitFor(() => expect(relations.result.current).toBe(true));
    expect(call.mock.calls[0][0]).toBe("meta");
    const properties = renderHook(() => useFlag("kg.properties"), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(properties.result.current).toBe(false);
  });

  it("is off when meta has no flags", async () => {
    vi.spyOn(dataSource, "call").mockResolvedValue({ generated_at: "2026-10-23T00:00:00Z" } as never);
    const { result } = renderHook(() => useFlag("kg.schema_map"), { wrapper });
    await waitFor(() => expect(dataSource.call).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
