import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MetaResponse, RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { __testing as storage } from "@/platform/storage";
import { useSettings } from "@/state/settings";

import SettingsPanel from "./SettingsPanel";

const META: MetaResponse = {
  generated_at: "2026-10-15T09:00:00Z",
  data: {
    live_stories: 1041,
    sample_stories: 171,
    forecasts: 31,
    entities: 5676,
    last_ingest_at: "2026-10-15T08:48:00Z",
    showing_sample: false,
  },
  sectors: [],
  sources: [
    {
      id: "gdelt",
      name: "GDELT Project",
      attribution: "News signals: The GDELT Project",
      homepage: "https://www.gdeltproject.org",
    },
    {
      id: "manifold",
      name: "Manifold",
      attribution: "Crowd forecasts: Manifold (play money)",
      homepage: "https://manifold.markets",
    },
    { id: "odd", name: "Odd source", attribution: "Odd attribution", homepage: "javascript:alert(1)" },
  ],
};

const mocks = vi.hoisted(() => ({
  meta: undefined as unknown,
  error: null as Error | null,
  refetch: vi.fn(),
  engine: { kind: "artifact", label: "Your Claude account" } as { kind: string; label: string },
}));

vi.mock("@/api/client", () => ({
  useRpc: (_name: RpcName) => ({
    data: mocks.meta,
    error: mocks.error,
    isPending: mocks.meta === undefined && !mocks.error,
    isError: !!mocks.error,
    isFetching: false,
    isPlaceholderData: false,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/ai/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai/engine")>()),
  getAiEngine: () => Promise.resolve({ ...mocks.engine, complete: vi.fn() }),
}));

vi.mock("./DesignPreview", () => ({ default: () => <h1>Design preview</h1> }));

const saved = () => JSON.parse(localStorage.getItem("worldgraph.settings.v1") ?? "{}") as Record<string, unknown>;
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  mocks.meta = META;
  mocks.error = null;
  mocks.refetch.mockReset();
  mocks.engine = { kind: "artifact", label: "Your Claude account" };
  localStorage.clear();
  storage.reset();
  useSettings.setState({ theme: "dark", sample: "auto", borders: "auto", calm: false });
});
afterEach(() => cleanup());

async function renderPanel() {
  render(<SettingsPanel panel={{ kind: "settings" }} />);
  await flush();
}

describe("SettingsPanel", () => {
  it("shows every section", async () => {
    await renderPanel();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Appearance",
      "Data and maps",
      "AI",
      "Your saved data",
      "Data sources",
      "About WorldGraph",
    ]);
  });

  it("switches the theme and saves it in this browser", async () => {
    await renderPanel();
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(useSettings.getState().theme).toBe("light");
    expect(saved()).toMatchObject({ theme: "light" });
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(saved()).toMatchObject({ theme: "system" });
  });

  it("sets sample data, with a line on what each choice does", async () => {
    await renderPanel();
    expect(screen.getByText("Shown only while there is no live news yet, then hidden.")).toBeTruthy();
    expect(screen.getByText("Right now: live news only.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(saved()).toMatchObject({ sample: "off" });
    expect(screen.getByText("Never shown. Some screens stay empty until live news arrives.")).toBeTruthy();
    expect(screen.queryByText(/Right now/)).toBeNull();
  });

  it("sets map borders, with a one-line explanation", async () => {
    await renderPanel();
    expect(screen.getByText(/^International borders here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "India's official view" }));
    expect(saved()).toMatchObject({ borders: "india" });
    expect(screen.getByText("Maps always show India's borders as India officially defines them.")).toBeTruthy();
  });

  it("turns on calm motion", async () => {
    await renderPanel();
    const calm = screen.getByRole("switch", { name: "Calm motion" });
    fireEvent.click(calm);
    expect(useSettings.getState().calm).toBe(true);
    expect(saved()).toMatchObject({ calm: true });
  });

  it("says which AI is used and what it costs", async () => {
    await renderPanel();
    const ai = section("AI");
    expect(within(ai).getByText("Your Claude account")).toBeTruthy();
    expect(within(ai).getByText("Uses your Claude account while the app is open")).toBeTruthy();
  });

  it("says the website's AI has a daily limit", async () => {
    mocks.engine = { kind: "api", label: "WorldGraph AI" };
    await renderPanel();
    expect(within(section("AI")).getByText("WorldGraph AI, daily limit")).toBeTruthy();
  });

  it("says where personal data is saved", async () => {
    await renderPanel();
    expect(within(section("Your saved data")).getByText("Saved in this browser")).toBeTruthy();
  });

  it("lists each source with its attribution and a safe link", async () => {
    await renderPanel();
    const sources = section("Data sources");
    expect(within(sources).getByText("1,041 live stories · 171 sample stories · 31 crowd forecasts. ", { exact: false })).toBeTruthy();
    expect(within(sources).getByText("News signals: The GDELT Project")).toBeTruthy();
    expect(within(sources).getByText("Crowd forecasts: Manifold (play money)")).toBeTruthy();
    const links = within(sources).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://www.gdeltproject.org", "https://manifold.markets"]);
    expect(links[0].getAttribute("aria-label")).toBe("GDELT Project website (new tab)");
    expect(links[0].getAttribute("rel")).toBe("noreferrer");
    expect(within(sources).getByText("Odd attribution")).toBeTruthy();
  });

  it("shows skeletons while sources load, and a retry when they fail", async () => {
    mocks.meta = undefined;
    await renderPanel();
    expect(within(section("Data sources")).queryAllByRole("link")).toHaveLength(0);
    cleanup();
    mocks.error = new DataError("unavailable", "timeout", true);
    await renderPanel();
    fireEvent.click(within(section("Data sources")).getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("explains WorldGraph and opens the design preview", async () => {
    await renderPanel();
    expect(within(section("About WorldGraph")).getByText(/WorldGraph shows how world events reach your business/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Design preview" }));
    await flush();
    const dialog = screen.getByRole("dialog", { name: "Design preview" });
    expect(within(dialog).getByRole("heading", { level: 1, name: "Design preview" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close the design preview" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
