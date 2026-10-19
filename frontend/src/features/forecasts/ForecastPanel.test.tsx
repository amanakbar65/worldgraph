import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForecastResponse, RpcName } from "@/api/contract";
import { getUserStore, __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { __testing as profileStore } from "@/state/profile";

import ForecastPanel from "./ForecastPanel";
import { DUBLIN, ECB, FED, FED_BRANCHES, NOW, detail } from "./fixtures";
import { CALL_TO_ACTION, fakeQuery } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown }[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown) => {
    mocks.calls.push({ name, args });
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null);
  },
}));

const top = () => useNav.getState().panels.at(-1);

function renderPanel(data: ForecastResponse | null = detail(), id = data?.forecast.id ?? FED.id) {
  mocks.responses = { forecast: data ?? undefined };
  useNav.setState({ panels: [{ kind: "forecast", id }] });
  return render(<ForecastPanel panel={{ kind: "forecast", id }} />);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.responses = {};
  mocks.errors = {};
  mocks.calls = [];
  useNav.setState({ panels: [], focus: null, sectors: [], window: "7d", view: "forecasts" });
  localStorage.clear();
  storage.reset();
  profileStore.reset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ForecastPanel", () => {
  it("asks for the forecast by id", () => {
    renderPanel();
    expect(mocks.calls).toContainEqual({ name: "forecast", args: { id: FED.id } });
  });

  it("shows the short title, the question in full and the crowd label", () => {
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: FED.short_title })).toBeTruthy();
    expect(screen.getByText(FED.question)).toBeTruthy();
    expect(screen.getAllByText("Crowd forecast").length).toBeGreaterThan(0);
    expect(screen.getByText("Finance")).toBeTruthy();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
  });

  it("shows the chance as a large ring, with YES and NO bars", () => {
    renderPanel();
    expect(screen.getByRole("img", { name: "Chance of YES: 63% crowd forecast, up 13 points in 24 hours" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "YES: 63% crowd forecast" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "NO: 37% crowd forecast" })).toBeTruthy();
    expect(screen.getByText("YES up 13 points in 24 hours.")).toBeTruthy();
  });

  it("shows volume, liquidity, the end date and the last update", () => {
    renderPanel(detail(ECB, { resolution_rule: null }, []));
    const tile = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";
    expect(tile("Volume")).toBe("48K MANA");
    expect(tile("Liquidity")).toBe("2.4K MANA");
    expect(tile("Ends")).toMatch(/in 2 mo$/);
    expect(tile("Last update")).toBe("12 min ago");
  });

  it("has no provider link when the API sends no URL", () => {
    renderPanel();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(/View on/)).toBeNull();
    expect(screen.getByText(/^Source:/).textContent).toBe("Source: Sample forecast");
  });

  it("links to the provider, in a new tab, only when the API sends a URL", () => {
    renderPanel(detail(ECB, {}, []));
    const link = screen.getByRole("link", { name: /^View on Manifold/ });
    expect(link.getAttribute("href")).toBe(ECB.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("never links an address that isn't a plain web link", () => {
    renderPanel(detail({ ...ECB, url: "javascript:alert(1)" }, {}, []));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("labels play money and explains the source", () => {
    renderPanel(detail(ECB, {}, []));
    expect(screen.getAllByText("Play money").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Play money: Manifold forecasters use a virtual currency \(MANA\), not cash\. Crowd forecasts are estimates and can be wrong\. For information only\./),
    ).toBeTruthy();
  });

  it("notes a thin market", () => {
    renderPanel(detail(DUBLIN, {}, []));
    expect(screen.getByText(/few forecasters and little volume/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Chance of YES: 19% crowd forecast, down 30 points in 24 hours, thin market/ })).toBeTruthy();
  });

  it("charts the history with a keyboard-readable chart", () => {
    renderPanel();
    const chart = screen.getByRole("group", { name: `${FED.short_title}: crowd forecast history` });
    expect(chart.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "Home" });
    expect(within(chart).getByText(/^50% on /)).toBeTruthy();
  });

  it("says how it resolves", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "How it resolves" });
    expect(within(section).getByText(/Resolves YES if the Federal Reserve/)).toBeTruthy();
    expect(within(section).getByText(/Outcomes: YES or NO\./)).toBeTruthy();
  });

  describe("If YES / If NO", () => {
    it("shows each outcome's chance and its possible effects with mechanism and confidence", () => {
      renderPanel();
      const section = screen.getByRole("region", { name: "If YES / If NO" });
      expect(within(section).getByText("If YES · 63%")).toBeTruthy();
      expect(within(section).getByText("If NO · 37%")).toBeTruthy();
      expect(within(section).getByText("Cheapens dollar funding")).toBeTruthy();
      expect(within(section).getByText("Revives dollar strength")).toBeTruthy();
      expect(within(section).getByRole("img", { name: "Confidence 55%, conditional link" })).toBeTruthy();
      expect(within(section).getByRole("img", { name: "Confidence 50%, conditional link" })).toBeTruthy();
      fireEvent.click(within(section).getByRole("button", { name: /A Fed cut would ease dollar-debt costs/ }));
      expect(top()).toEqual({ kind: "story", id: "story:fed-cut-eases-em-debt" });
    });

    it("still shows an outcome with nothing linked, with its chance", () => {
      renderPanel(detail(FED, {}, [FED_BRANCHES[0]]));
      const section = screen.getByRole("region", { name: "If YES / If NO" });
      expect(within(section).getByText("If NO · 37%")).toBeTruthy();
      expect(within(section).getByText("No effects linked")).toBeTruthy();
    });

    it("says when no effects are linked yet", () => {
      renderPanel(detail(FED, {}, []));
      expect(screen.getByText("No effects linked yet")).toBeTruthy();
    });

    it("has no branches for a question with other outcomes, and lists them instead", () => {
      renderPanel(detail(FED, { outcomes: ["Hold", "Cut", "Hike"] }, []));
      expect(screen.queryByRole("region", { name: "If YES / If NO" })).toBeNull();
      expect(screen.getByText("Hike")).toBeTruthy();
      expect(screen.getByRole("img", { name: /^Chance of Hold: 63% crowd forecast/ })).toBeTruthy();
      expect(screen.getByText("Hold up 13 points in 24 hours.")).toBeTruthy();
    });
  });

  it("lists related stories; a draft shows its source headline and no summary", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: /^Related stories/ });
    const draft = within(section).getByRole("button", { name: /US payrolls report shows slower hiring/ });
    expect(within(draft).getByText("Draft · awaiting analysis")).toBeTruthy();
    expect(within(section).getByText("Opportunity")).toBeTruthy();
    expect(screen.queryByText("Dollar borrowers could pay less within months.")).toBeNull();
    fireEvent.click(draft);
    expect(top()).toEqual({ kind: "story", id: "story:live-payrolls-draft" });
  });

  it("opens what the forecast is about: places fly the globe there", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: /^What it's about/ });
    fireEvent.click(within(section).getByRole("button", { name: /^United States of America/ }));
    expect(top()).toEqual({ kind: "region", id: "region:us" });
    expect(useNav.getState().focus?.regionId).toBe("region:us");
    fireEvent.click(within(section).getByRole("button", { name: /^Federal Reserve/ }));
    expect(top()).toEqual({ kind: "entity", id: "organization:federal-reserve" });
  });

  it("adds the forecast to the watchlist and takes it off again", async () => {
    renderPanel();
    const watch = screen.getByRole("button", { name: "Watch" });
    await waitFor(() => expect(watch.hasAttribute("disabled")).toBe(false));
    fireEvent.click(watch);
    expect(screen.getByRole("button", { name: "Watching" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Added to your watchlist.")).toBeTruthy();
    await waitFor(async () => expect(await (await getUserStore()).get("watchlist")).toEqual([FED.id]));
    fireEvent.click(screen.getByRole("button", { name: "Watching" }));
    expect(screen.getByText("Removed from your watchlist.")).toBeTruthy();
    await waitFor(async () => expect(await (await getUserStore()).get("watchlist")).toEqual([]));
  });

  it("edits the same watchlist as My Business, so a removal there sticks", async () => {
    const panama = "forecast:panama-draft-limits-lifted";
    profileStore.stores.watchlist.setState({ value: [panama, "region:in"], loaded: true, kind: "browser" });
    renderPanel();
    // My Business takes India off while this panel is open...
    profileStore.stores.watchlist.getState().set((prev) => prev.filter((id) => id !== "region:in"));
    // ...then the viewer watches this forecast.
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(profileStore.stores.watchlist.getState().value).toEqual([panama, FED.id]);
    await waitFor(async () => expect(await (await getUserStore()).get("watchlist")).toEqual([panama, FED.id]));
  });

  it("keeps the forecast on screen when a background refresh fails", () => {
    mocks.errors = { forecast: new Error("The database didn't answer.") };
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: FED.short_title })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks about this forecast", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Ask about this forecast" }));
    expect(top()).toEqual({ kind: "ask", scope: FED.id });
  });

  it("shows a skeleton while loading", () => {
    renderPanel(null, FED.id);
    expect(screen.getByLabelText("Loading forecast")).toBeTruthy();
  });

  it("says when the forecast is no longer available", () => {
    mocks.errors = { forecast: new Error("Not found: forecast:gone") };
    renderPanel(null, "forecast:gone");
    expect(screen.getByRole("alert").textContent).toContain("No longer available");
  });

  it("is information only: no control invites anyone to bet or trade", () => {
    renderPanel(detail(ECB));
    for (const control of [...screen.getAllByRole("button"), ...screen.queryAllByRole("link")]) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name).not.toMatch(CALL_TO_ACTION);
    }
    expect(document.body.textContent).not.toMatch(/\b(bet|betting|wager|trading)\b/i);
  });
});
