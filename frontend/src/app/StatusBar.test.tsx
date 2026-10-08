import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "./StatusBar";
import { __testing, useAnalysisStatus } from "@/ai/analysis-runner";
import { DataError } from "@/api/source";
import { useConnectorApproval } from "@/api/sources/connector";
import { freshnessText } from "@/lib/status-freshness";

const mocks = vi.hoisted(() => ({ meta: null as unknown }));

vi.mock("@/api/client", async () => {
  const { create } = await import("zustand");
  return {
    useConnection: create(() => ({
      state: { status: "live", source: "connector" } as Record<string, unknown>,
    })),
    useRpc: () => ({ data: mocks.meta, isLoading: false, error: null }),
  };
});

const { useConnection } = (await import("@/api/client")) as unknown as {
  useConnection: { setState: (s: unknown) => void };
};

const meta = (lastIngest: string | null, showingSample = false) => ({
  generated_at: "2026-10-08T10:00:00Z",
  data: {
    live_stories: 3,
    sample_stories: 0,
    forecasts: 1,
    entities: 9,
    last_ingest_at: lastIngest,
    showing_sample: showingSample,
  },
  sectors: [],
  sources: [],
});

beforeEach(() => {
  __testing.reset();
  useConnection.setState({ state: { status: "live", source: "connector" } });
  useConnectorApproval.setState({ waiting: [], asking: false });
  mocks.meta = meta(new Date(Date.now() - 4 * 60_000).toISOString());
});
afterEach(cleanup);

describe("StatusBar", () => {
  it("shows live data and how fresh it is", () => {
    render(<StatusBar />);
    expect(screen.getByText("Live data")).toBeTruthy();
    expect(screen.getByText("Updated 4 min ago")).toBeTruthy();
  });

  it("labels sample data and leaves out the freshness note", () => {
    mocks.meta = meta(null, true);
    render(<StatusBar />);
    expect(screen.getByText("Sample data")).toBeTruthy();
    expect(screen.queryByText(/Updated/)).toBeNull();
  });

  it("explains the sample snapshot when the connector isn't there", () => {
    useConnection.setState({
      state: {
        status: "snapshot",
        reason: new DataError(
          "connector_missing",
          "Add the Supabase connector in claude.ai Settings → Connectors.",
        ),
      },
    });
    render(<StatusBar />);
    expect(screen.getByText(/Sample snapshot · Add the Supabase connector/)).toBeTruthy();
  });

  it("shows on-use analysis with a Stop button", () => {
    const stop = vi.fn();
    useAnalysisStatus.setState({ status: { phase: "running", count: 6, batch: 1, analysed: 0 }, stop });
    render(<StatusBar />);
    expect(screen.getByText("Analysing 6 new stories with your Claude account…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop analysing stories" }));
    expect(stop).toHaveBeenCalled();
    act(() => useAnalysisStatus.setState({ status: { phase: "done", analysed: 12, skipped: 0 } }));
    expect(screen.getByText("12 stories analysed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop analysing stories" })).toBeNull();
  });

  it("asks for approval when the connector needs it", () => {
    useConnectorApproval.setState({
      waiting: [{ id: 1, run: vi.fn(), resolve: vi.fn(), reject: vi.fn() }],
      asking: false,
    });
    render(<StatusBar />);
    expect(screen.getByText("Live data needs your approval")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow live data from Supabase" })).toBeTruthy();
  });
});

describe("freshnessText", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  it.each([
    ["2026-10-08T11:59:40Z", "Updated just now", "Just now"],
    ["2026-10-08T11:56:00Z", "Updated 4 min ago", "4 min ago"],
    ["2026-10-08T09:00:00Z", "Updated 3 h ago", "3 h ago"],
    ["2026-10-07T11:00:00Z", "Updated 1 day ago", "1 day ago"],
    ["2026-10-05T11:00:00Z", "Updated 3 days ago", "3 days ago"],
  ])("%s → %s", (iso, long, short) => {
    expect(freshnessText(iso, now)).toEqual({ long, short });
  });
  it("is empty without a time", () => {
    expect(freshnessText(null, now)).toBeNull();
    expect(freshnessText("not a date", now)).toBeNull();
  });
});
