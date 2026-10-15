import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile, RpcArgs, RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { __testing as profileStore, emptyProfile } from "@/state/profile";
import { useSettings } from "@/state/settings";

import { CALL_TO_ACTION, fakeQuery } from "@/features/business/test-utils";

import { APPAREL, DRAFT, ITEMS, NOW, PROFILE, RESPONSE, RUPEE, TRADE_DEAL } from "./fixtures";
import OpportunitiesView from "./OpportunitiesView";
import { DEFAULT_PREFS, useOpportunityPrefs } from "./prefs";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
  refetch: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    mocks.calls.push({ name, args, enabled });
    if (!enabled) return fakeQuery(undefined);
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null, mocks.refetch);
  },
}));

vi.mock("@/lib/hooks", () => ({ useIsDesktop: () => true, useMediaQuery: () => true }));

const sent = () =>
  mocks.calls.filter((c) => c.name === "opportunities" && c.enabled).map((c) => c.args as RpcArgs["opportunities"]);
const lastSent = () => sent().at(-1);
const top = () => useNav.getState().panels.at(-1);

function withProfile(profile: Profile) {
  profileStore.stores.profile.setState({ value: profile, loaded: true, kind: "browser" });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.responses = { opportunities: RESPONSE };
  mocks.errors = {};
  mocks.calls = [];
  useNav.setState({ panels: [], focus: null, sectors: [], window: "7d", view: "opportunities" });
  useSettings.setState({ sample: "auto" });
  useOpportunityPrefs.setState({ ...DEFAULT_PREFS });
  localStorage.clear();
  storage.reset();
  profileStore.reset();
  withProfile(emptyProfile);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cards = () =>
  within(screen.getByRole("list", { name: "Openings" }))
    .getAllByRole("article")
    .map((a) => a.getAttribute("aria-label"));

describe("OpportunitiesView", () => {
  it("lists the openings in the order given, with a summary and the sample label", () => {
    render(<OpportunitiesView />);
    expect(screen.getByRole("heading", { level: 1, name: "Opportunities" })).toBeTruthy();
    expect(screen.getByText(/4 openings in the last 7 days, 1 with a crowd forecast\./)).toBeTruthy();
    expect(screen.getAllByText("Sample").length).toBeGreaterThan(0);
    expect(cards()).toEqual([
      `1. ${RUPEE.story.headline}`,
      `2. ${TRADE_DEAL.story.headline}`,
      `3. ${APPAREL.story.headline}`,
      `4. ${DRAFT.story.headline}`,
    ]);
  });

  it("shows why now, who it suits and the two scores on each card", () => {
    render(<OpportunitiesView />);
    const card = screen.getByRole("article", { name: `1. ${RUPEE.story.headline}` });
    expect(within(card).getByText(RUPEE.why_now)).toBeTruthy();
    expect(within(card).getByText("Suits")).toBeTruthy();
    expect(within(card).getAllByText("Finance").length).toBeGreaterThan(0);
    expect(within(card).getByRole("img", { name: "Importance 77%" })).toBeTruthy();
    expect(within(card).getByRole("img", { name: "Momentum 84%" })).toBeTruthy();
  });

  it("labels a draft and never invents a 'why now' for it", () => {
    render(<OpportunitiesView />);
    const card = screen.getByRole("article", { name: `4. ${DRAFT.story.headline}` });
    expect(within(card).getByText("Draft · awaiting analysis")).toBeTruthy();
    expect(within(card).queryByText(/Why now/)).toBeNull();
  });

  it("marks projections apart from reported events", () => {
    render(<OpportunitiesView />);
    const card = screen.getByRole("article", { name: `3. ${APPAREL.story.headline}` });
    expect(within(card).getByText("Projected")).toBeTruthy();
  });

  it("shows the related crowd forecast with its source, volume and update, and opens it", () => {
    render(<OpportunitiesView />);
    const card = screen.getByRole("article", { name: `1. ${RUPEE.story.headline}` });
    const forecast = within(card).getByRole("button", { name: /Will the RBI cut the repo rate/ });
    expect(within(forecast).getByText("Crowd forecast")).toBeTruthy();
    expect(within(forecast).getByText("Manifold")).toBeTruthy();
    expect(within(forecast).getByText("88K MANA volume")).toBeTruthy();
    expect(within(forecast).getByText(/Updated/)).toBeTruthy();
    expect(within(forecast).getByRole("img", { name: /29% crowd forecast, down 12 points/ })).toBeTruthy();
    fireEvent.click(forecast);
    expect(top()).toEqual({ kind: "forecast", id: RBI_ID });
  });

  it("opens the story from its headline", () => {
    render(<OpportunitiesView />);
    fireEvent.click(screen.getByRole("button", { name: TRADE_DEAL.story.headline }));
    expect(top()).toEqual({ kind: "story", id: TRADE_DEAL.story.id });
  });

  it("draws one radar dot per opening; arrow keys move between them and Enter opens one", () => {
    render(<OpportunitiesView />);
    const radar = screen.getByRole("group", { name: /Opportunity radar, 4 openings by sector/ });
    const dots = within(radar).getAllByRole("button");
    expect(dots).toHaveLength(4);
    const first = within(radar).getByRole("button", { name: /^1\. Rupee firms.*Finance, importance 77%, momentum 84%, crowd forecast 29%/ });
    expect(first.getAttribute("tabindex")).toBe("0");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = within(radar).getByRole("button", { name: /^2\. Officials signal/ });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Enter" });
    expect(top()).toEqual({ kind: "story", id: TRADE_DEAL.story.id });
  });

  it("offers the radar as a plain list", () => {
    render(<OpportunitiesView />);
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    const list = screen.getByRole("list", { name: "Openings, best first" });
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(within(list).getByRole("button", { name: /Indian apparel exporters/ }));
    expect(top()).toEqual({ kind: "story", id: APPAREL.story.id });
  });

  it("switches what the distance from the centre shows", () => {
    render(<OpportunitiesView />);
    expect(screen.getByText(/Closer to the centre: more important\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Momentum" }));
    expect(useOpportunityPrefs.getState().measure).toBe("momentum");
    expect(screen.getByText(/Closer to the centre: gaining pace faster\./)).toBeTruthy();
  });

  it("without a profile: asks for none, and offers to set one up", () => {
    render(<OpportunitiesView />);
    expect(lastSent()).toEqual({ window: "7d" });
    expect(screen.queryByRole("group", { name: "Rank the openings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up My Business" }));
    expect(useNav.getState().view).toBe("business");
  });

  it("waits for the stored profile before asking", () => {
    profileStore.stores.profile.setState({ loaded: false });
    render(<OpportunitiesView />);
    expect(sent()).toEqual([]);
    expect(screen.getByLabelText("Loading the radar")).toBeTruthy();
  });

  it("with a profile: ranks for it, says why each fits, and can switch to everyone", () => {
    withProfile(PROFILE);
    render(<OpportunitiesView />);
    expect(lastSent()).toEqual({ window: "7d", profile: PROFILE });
    expect(screen.getByText(/Ranked for your business\./)).toBeTruthy();
    const card = screen.getByRole("article", { name: `2. ${TRADE_DEAL.story.headline}` });
    expect(within(card).getByText("Fits you")).toBeTruthy();
    expect(within(card).getByText("“tariffs”")).toBeTruthy();
    expect(within(card).getByRole("img", { name: "Fit 67%" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "For everyone" }));
    expect(lastSent()).toEqual({ window: "7d" });
    expect(screen.queryByText("Fits you")).toBeNull();
  });

  it("narrows to your places", () => {
    withProfile(PROFILE);
    render(<OpportunitiesView />);
    fireEvent.click(screen.getByRole("button", { name: "Only your places" }));
    expect(lastSent()?.regions).toEqual(["region:in-gj", "region:cn", "region:us"]);
  });

  it("uses the shared sector lens and the window", () => {
    render(<OpportunitiesView />);
    const lens = screen.getByRole("group", { name: "Sector lens" });
    fireEvent.click(within(lens).getByRole("button", { name: "Energy" }));
    expect(useNav.getState().sectors).toEqual(["energy"]);
    expect(lastSent()?.sectors).toEqual(["energy"]);
    // The radar shows only the lens.
    expect(screen.getByRole("group", { name: /Opportunity radar, 2 openings by sector/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
    expect(useNav.getState().window).toBe("30d");
    expect(lastSent()?.window).toBe("30d");
  });

  it("passes the sample setting through", () => {
    useSettings.setState({ sample: "off" });
    render(<OpportunitiesView />);
    expect(lastSent()).toEqual({ window: "7d", sample: false });
  });

  it("suggests a longer window when nothing is found", () => {
    mocks.responses = { opportunities: { items: [] } };
    useNav.setState({ window: "24h", sectors: ["health"] });
    render(<OpportunitiesView />);
    expect(screen.getByText("No openings in the last 24 hours")).toBeTruthy();
    const widen = screen.getAllByRole("button", { name: "All sectors" }).find((b) => !b.hasAttribute("aria-pressed"));
    fireEvent.click(widen!);
    expect(useNav.getState().sectors).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Show 30 days" }));
    expect(useNav.getState().window).toBe("30d");
  });

  it("explains a failure and retries", () => {
    mocks.responses = {};
    mocks.errors = { opportunities: new DataError("unavailable", "asleep", true) };
    render(<OpportunitiesView />);
    expect(screen.getByText("The data is taking a moment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("never invites anyone to bet or trade", () => {
    withProfile(PROFILE);
    const { container } = render(<OpportunitiesView />);
    expect(container.textContent ?? "").not.toMatch(/\b(bet|betting|wager|trading|odds to win)\b/i);
    for (const button of screen.getAllByRole("button")) expect(button.textContent ?? "").not.toMatch(CALL_TO_ACTION);
  });

  it("highlights a card while its dot is under the pointer", () => {
    render(<OpportunitiesView />);
    const radar = screen.getByRole("group", { name: /Opportunity radar/ });
    fireEvent.mouseEnter(within(radar).getByRole("button", { name: /^3\. Indian apparel/ }));
    const card = screen.getByRole("article", { name: `3. ${APPAREL.story.headline}` });
    expect(card.className).toContain("border-fg/40");
    expect(ITEMS).toHaveLength(4);
  });
});

const RBI_ID = "forecast:rbi-repo-cut";
