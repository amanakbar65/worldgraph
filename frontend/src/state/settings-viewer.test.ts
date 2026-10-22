import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIndiaBorders, useServerViewer, useSettings } from "./settings";

vi.mock("@/platform/runtime", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/platform/runtime")>();
  // A browser outside India (timezone and locale), so only the server's country decides.
  return { ...real, viewerLooksIndian: (c?: string | null) => c === "IN" };
});

describe("India's borders on 'auto'", () => {
  afterEach(() => {
    useServerViewer.setState({ country: null });
    useSettings.setState({ borders: "auto" });
  });

  it("follow the country the website's server reports", () => {
    useSettings.setState({ borders: "auto" });
    useServerViewer.setState({ country: "IN" });
    expect(renderHook(() => useIndiaBorders()).result.current).toBe(true);
    useServerViewer.setState({ country: "US" });
    expect(renderHook(() => useIndiaBorders()).result.current).toBe(false);
  });

  it("an explicit setting wins over the server's country", () => {
    useServerViewer.setState({ country: "US" });
    useSettings.setState({ borders: "india" });
    expect(renderHook(() => useIndiaBorders()).result.current).toBe(true);
  });
});
