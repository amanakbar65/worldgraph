import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "./StatusBar";
import { __testing, useAnalysisStatus } from "@/ai/analysis-runner";
import { DataError } from "@/api/source";
import { useConnectorApproval } from "@/api/sources/connector";
import { useSnapshot } from "@/api/sources/static";
import { freshnessText } from "@/lib/status-freshness";
import { useNav } from "@/state/nav";
import { useSettings } from "@/state/settings";

const mocks = vi.hoisted(() => ({ meta: null as unknown, placeholder: false }));

vi.mock("@/api/client", async () => {
  const { create } = await import("zustand");
  return {
    useConnection: create(() => ({
      state: { status: "live", source: "connector" } as Record<string, unknown>,
    })),
    useRpc: () => ({ data: mocks.meta, isLoading: false, error: null, isPlaceholderData: mocks.placeholder }),
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

/** Pretend the window is this wide (the pill floats from 768 px, and sits in the header below). */
function viewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: /min-width: 768px/.test(query) ? width >= 768 : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  viewport(1440);
  __testing.reset();
  useConnection.setState({ state: { status: "live", source: "connector" } });
  useConnectorApproval.setState({ waiting: [], asking: false });
  mocks.meta = meta(new Date(Date.now() - 4 * 60_000).toISOString());
  mocks.placeholder = false;
  useSnapshot.setState({ kind: null, asOf: null, data: new Map() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StatusBar", () => {
  it("floats on wider screens and sits in the header on phones, never both", () => {
    const both = () => (
      <>
        <header>
          <StatusBar placement="header" />
        </header>
        <StatusBar />
      </>
    );
    const { unmount } = render(both());
    expect(screen.getAllByText("Live data")).toHaveLength(1);
    expect(screen.getByText("Live data").closest("header")).toBeNull();
    unmount();

    viewport(390);
    render(both());
    expect(screen.getAllByText("Live")).toHaveLength(1);
    expect(screen.getByText("Live").closest("header")).not.toBeNull();
  });

  it("floats only over the globe on wider screens; other screens show it in the header, off the content", () => {
    const both = () => (
      <>
        <header>
          <StatusBar placement="header" />
        </header>
        <StatusBar />
      </>
    );
    try {
      for (const view of ["forecasts", "opportunities", "brief"] as const) {
        useNav.setState({ view });
        const { unmount } = render(both());
        expect(screen.getAllByText("Live")).toHaveLength(1);
        expect(screen.getByText("Live").closest("header"), view).not.toBeNull();
        unmount();
      }
    } finally {
      useNav.setState({ view: "globe" });
    }
  });

  it("keeps only what needs the viewer in the phone header", () => {
    viewport(390);
    useConnectorApproval.setState({
      waiting: [{ id: 1, run: vi.fn(), resolve: vi.fn(), reject: vi.fn() }],
      asking: false,
    });
    const { unmount } = render(<StatusBar placement="header" />);
    expect(screen.getByText("Needs approval")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow live data from Supabase" })).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
    unmount();

    useConnectorApproval.setState({ waiting: [], asking: false });
    useAnalysisStatus.setState({
      status: { phase: "running", count: 6, batch: 1, analysed: 0 },
      stop: vi.fn(),
    });
    render(<StatusBar placement="header" />);
    expect(screen.getByText("Analysing…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop analysing stories" })).toBeTruthy();
  });

  it("shows live data and how fresh it is", () => {
    render(<StatusBar />);
    expect(screen.getByText("Live data")).toBeTruthy();
    expect(screen.getByText("Updated 4 min ago")).toBeTruthy();
  });

  it("says when sample data is switched on beside live data, on phones too", () => {
    useSettings.setState({ sample: "on" });
    try {
      const { unmount } = render(<StatusBar />);
      expect(screen.getByText("Live data with sample data")).toBeTruthy();
      unmount();
      viewport(390);
      render(<StatusBar placement="header" />);
      expect(screen.getByText("Live + sample")).toBeTruthy();
    } finally {
      useSettings.setState({ sample: "auto" });
    }
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

  describe("with a live snapshot", () => {
    const asOf = new Date(Date.now() - 3 * 3_600_000).toISOString();
    beforeEach(() => useSnapshot.setState({ kind: "live", asOf, data: new Map([["meta:{}", {}]]) }));

    it("says the first frame is a snapshot and when it was taken, never live data", () => {
      useConnection.setState({ state: { status: "connecting" } });
      mocks.placeholder = true;
      mocks.meta = meta(asOf);
      const { unmount } = render(<StatusBar />);
      expect(screen.getByText(/^Snapshot as of .+ · connecting…$/)).toBeTruthy();
      expect(screen.queryByText(/Live data/)).toBeNull();
      expect(screen.queryByText(/Updated/)).toBeNull();
      unmount();
      viewport(390);
      render(<StatusBar placement="header" />);
      expect(screen.getByText("Snapshot · 3 h ago")).toBeTruthy();
    });

    it("says it is showing the snapshot when the connector isn't there", () => {
      useConnection.setState({
        state: {
          status: "snapshot",
          reason: new DataError(
            "not_allowed",
            "Live data wasn't approved, so WorldGraph is showing sample data.",
          ),
        },
      });
      render(<StatusBar />);
      expect(screen.getByText(/^Snapshot as of .+ · Live data wasn't approved\.$/)).toBeTruthy();
      expect(screen.queryByText(/sample/i)).toBeNull();
    });
  });

  it("calls a sample first frame a saved sample", () => {
    useSnapshot.setState({
      kind: "sample",
      asOf: new Date().toISOString(),
      data: new Map([["meta:{}", {}]]),
    });
    useConnection.setState({ state: { status: "connecting" } });
    mocks.placeholder = true;
    mocks.meta = meta(null, true);
    render(<StatusBar />);
    expect(screen.getByText("Saved sample · connecting to live data…")).toBeTruthy();
  });

  it("says plainly when live data isn't connected and nothing stands in for it", () => {
    useConnection.setState({
      state: {
        status: "disconnected",
        reason: new DataError(
          "connector_missing",
          "Add the Supabase connector in claude.ai Settings → Connectors.",
        ),
      },
    });
    mocks.meta = undefined;
    const { unmount } = render(<StatusBar />);
    expect(
      screen.getByText(
        "Live data isn't connected · Add the Supabase connector in claude.ai Settings → Connectors.",
      ),
    ).toBeTruthy();
    unmount();
    viewport(390);
    render(<StatusBar placement="header" />);
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("keeps the Allow button while live data isn't connected", () => {
    useConnection.setState({
      state: { status: "disconnected", reason: new DataError("not_allowed", "Live data wasn't approved.") },
    });
    useConnectorApproval.setState({
      waiting: [{ id: 1, run: vi.fn(), resolve: vi.fn(), reject: vi.fn() }],
      asking: false,
    });
    mocks.meta = undefined;
    render(<StatusBar />);
    expect(screen.getByText("Live data isn't connected · Live data wasn't approved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow live data from Supabase" })).toBeTruthy();
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
