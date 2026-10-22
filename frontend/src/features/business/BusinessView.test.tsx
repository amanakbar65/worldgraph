import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile, RpcArgs, RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { __testing as storage } from "@/platform/storage";
import { useNav } from "@/state/nav";
import { __testing as profileStore, DEFAULT_ALERT_RULES, emptyProfile } from "@/state/profile";
import { useSettings } from "@/state/settings";

import BusinessView from "./BusinessView";
import { AFFECTS, CASCADE, DRAFT, FREIGHT, INDIA_ENTITY, NOW, OPEC, OPEC_DETAIL, PROFILE, RED_SEA, RUPEE, hoursAgo } from "./fixtures";
import { BusinessAlertBadge } from "./NavBadge";
import { resetFirstRun } from "./setup-state";
import { CALL_TO_ACTION, fakeQuery } from "./test-utils";

const mocks = vi.hoisted(() => ({
  responses: {} as Partial<Record<string, unknown>>,
  errors: {} as Partial<Record<string, Error>>,
  calls: [] as { name: string; args: unknown; enabled: boolean }[],
  entities: {} as Record<string, unknown>,
  forecasts: {} as Record<string, unknown>,
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: { id?: string }, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    mocks.calls.push({ name, args, enabled });
    if (!enabled) return fakeQuery(undefined);
    if (name === "entity") return fakeQuery(args.id ? mocks.entities[args.id] : undefined);
    return fakeQuery(mocks.responses[name], mocks.errors[name] ?? null);
  },
  rpcKey: (name: string, args: unknown) => ["rpc", name, JSON.stringify(args)],
  dataSource: {
    kind: "http",
    call: (name: RpcName, args: { id: string }) => {
      const table = name === "forecast" ? mocks.forecasts : mocks.entities;
      const found = table[args.id];
      return found ? Promise.resolve(found) : Promise.reject(new Error("Not found"));
    },
  },
}));

vi.mock("@/lib/hooks", () => ({ useIsDesktop: () => true, useMediaQuery: () => true }));

// jsdom has no scrolling.
Element.prototype.scrollTo ??= () => {};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const view = () => render(<BusinessView />, { wrapper });

function seed({
  profile = PROFILE,
  watchlist = [] as string[],
  lastSeen = null as string | null,
}: { profile?: Profile; watchlist?: string[]; lastSeen?: string | null } = {}) {
  profileStore.stores.profile.setState({ value: profile, loaded: true, kind: "browser" });
  profileStore.stores.watchlist.setState({ value: watchlist, loaded: true, kind: "browser" });
  profileStore.stores.rules.setState({ value: DEFAULT_ALERT_RULES, loaded: true, kind: "browser" });
  profileStore.stores.lastSeen.setState({ value: lastSeen, loaded: true, kind: "browser" });
}

const affectsCalls = () =>
  mocks.calls.filter((c) => c.name === "affects" && c.enabled).map((c) => c.args as RpcArgs["affects"]);
const top = () => useNav.getState().panels.at(-1);
const feed = () => screen.getByRole("list", { name: "Stories that affect you" });
const card = (headline: string) => within(feed()).getByRole("article", { name: headline });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.responses = { affects: AFFECTS, cascade: CASCADE };
  mocks.errors = {};
  mocks.calls = [];
  mocks.entities = { "region:in": INDIA_ENTITY };
  mocks.forecasts = { [OPEC.id]: OPEC_DETAIL };
  useNav.setState({ panels: [], focus: null, sectors: [], window: "7d", view: "business" });
  useSettings.setState({ sample: "auto" });
  localStorage.clear();
  storage.reset();
  profileStore.reset();
  resetFirstRun();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BusinessView: first run", () => {
  beforeEach(() => seed({ profile: emptyProfile }));

  it("starts with a short, skippable setup that says where it's saved", () => {
    view();
    expect(screen.getByRole("heading", { level: 1, name: "Set up My Business" })).toBeTruthy();
    const steps = screen.getByRole("navigation", { name: "Setup steps" });
    expect(within(steps).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Saved in this browser")).toBeTruthy();
    expect(screen.getByText(/Only your choices and keywords, nothing personal/)).toBeTruthy();
    expect(affectsCalls()).toEqual([]);
  });

  it("saves each choice as it's made, and moves through the steps", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Energy" }));
    expect(profileStore.stores.profile.getState().value.sectors).toEqual(["energy"]);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Where do you work?" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Add to where you operate" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("heading", { level: 2, name: "What do you depend on?" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "Cold chain, cotton yarn" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(profileStore.stores.profile.getState().value.keywords).toEqual(["cold chain", "cotton yarn"]);
    fireEvent.click(screen.getByRole("button", { name: /See what affects you/ }));
    expect(screen.getByRole("heading", { level: 1, name: "My Business" })).toBeTruthy();
  });

  it("can be skipped, leaving a friendly way back in", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(screen.getByText("Tell us about your business")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set up My Business" }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit your business profile" })).toBeTruthy();
  });
});

describe("BusinessView: the dashboard", () => {
  it("asks api.affects for the profile in the current window, with the sample setting", () => {
    seed();
    useSettings.setState({ sample: "on" });
    view();
    expect(affectsCalls().at(-1)).toEqual({ profile: PROFILE, window: "7d", sample: true });
  });

  it("shows what affects you, why, how relevant, and what you could do", () => {
    seed();
    view();
    expect(within(feed()).getAllByRole("article")).toHaveLength(4);
    const red = card(RED_SEA.headline);
    expect(within(red).getByText("Direct")).toBeTruthy();
    expect(within(red).getByRole("img", { name: "Relevance 88%" })).toBeTruthy();
    expect(within(red).getByText(/Touches Bab-el-Mandeb Strait \(your input\)/)).toBeTruthy();
    expect(within(red).getByText("Check contracts for war-risk surcharge clauses")).toBeTruthy();
    fireEvent.click(within(red).getByRole("button", { name: RED_SEA.headline }));
    expect(top()).toEqual({ kind: "story", id: RED_SEA.id });
  });

  it("labels drafts and shows no so-what or actions for them", () => {
    seed();
    view();
    const draft = card(DRAFT.headline);
    expect(within(draft).getByText("Draft · awaiting analysis")).toBeTruthy();
    expect(within(draft).queryByText("Should not show for a draft")).toBeNull();
    expect(within(draft).queryByText("What you could do")).toBeNull();
  });

  it("shows how a knock-on story reaches you, with the link's type and confidence", () => {
    seed();
    view();
    const knock = card(FREIGHT.headline);
    expect(within(knock).getByText("Knock-on · 1 step")).toBeTruthy();
    fireEvent.click(within(knock).getByRole("button", { name: "How it reaches you" }));
    const chain = within(knock).getByRole("list", { name: "From the story that touches you to this one" });
    expect(within(chain).getByText("longer shipping routes")).toBeTruthy();
    expect(within(chain).getByRole("img", { name: "Confidence 70%, inferred link" })).toBeTruthy();
    expect(mocks.calls.some((c) => c.name === "cascade" && (c.args as { id: string }).id === FREIGHT.id)).toBe(true);
  });

  it("keeps the chain on screen when a refresh of it fails", () => {
    mocks.errors = { cascade: new DataError("unavailable", "The database didn't answer.", true) };
    seed();
    view();
    const knock = card(FREIGHT.headline);
    fireEvent.click(within(knock).getByRole("button", { name: "How it reaches you" }));
    const chain = within(knock).getByRole("list", { name: "From the story that touches you to this one" });
    expect(within(chain).getByText("longer shipping routes")).toBeTruthy();
    expect(within(knock).queryByRole("alert")).toBeNull();
  });

  it("filters by impact, route and the part of the business it reaches", () => {
    seed();
    view();
    fireEvent.click(screen.getByRole("radio", { name: "Opportunities, 1" }));
    expect(within(feed()).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([RUPEE.headline]);
    fireEvent.click(screen.getByRole("radio", { name: "All, 4" }));
    fireEvent.click(screen.getByRole("radio", { name: "Knock-on effects, 1" }));
    expect(within(feed()).getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Any route" }));
    fireEvent.click(screen.getByRole("button", { name: /^Gujarat, where you operate: 1 story/ }));
    expect(within(feed()).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([DRAFT.headline]);
    fireEvent.click(screen.getByRole("button", { name: "Show all stories, not only Gujarat" }));
    expect(within(feed()).getAllByRole("article")).toHaveLength(4);
  });

  it("suggests crowd forecasts with source, volume and update, and adds them to the watchlist", () => {
    seed();
    view();
    const section = screen.getByRole("region", { name: "Crowd forecasts for you" });
    expect(within(section).getByText(/Crowd forecasts are estimates and can be wrong/)).toBeTruthy();
    expect(within(section).getByText("Source: Manifold")).toBeTruthy();
    expect(within(section).getByText("52K MANA volume")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: `Watch ${OPEC.short_title}` }));
    expect(profileStore.stores.watchlist.getState().value).toEqual([OPEC.id]);
  });

  it("explains a failure", () => {
    seed();
    mocks.responses = {};
    mocks.errors = { affects: new DataError("unavailable", "asleep", true) };
    view();
    expect(screen.getByText("The data is taking a moment")).toBeTruthy();
  });

  it("suggests a longer window when nothing touches the business", () => {
    seed();
    mocks.responses = { affects: { items: [], suggested_forecasts: [] } };
    view();
    expect(screen.getByText("Nothing touches your business in the last 7 days")).toBeTruthy();
  });

  it("opens the editor from Edit profile", () => {
    seed();
    view();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByRole("heading", { level: 1, name: "Edit your business profile" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("heading", { level: 1, name: "My Business" })).toBeTruthy();
  });

  it("never invites anyone to bet or trade", () => {
    seed({ watchlist: [OPEC.id] });
    const { container } = view();
    expect(container.textContent ?? "").not.toMatch(/\b(bet|betting|wager|trading|odds to win)\b/i);
    for (const button of screen.getAllByRole("button")) expect(button.textContent ?? "").not.toMatch(CALL_TO_ACTION);
  });
});

describe("BusinessView: alerts since the last visit", () => {
  it("on the first visit, explains what will show up", () => {
    seed();
    view();
    expect(screen.getByText(/From your next visit, new stories that match your business/)).toBeTruthy();
  });

  it("counts new matching stories, watched news and big forecast moves since the last visit", async () => {
    seed({ watchlist: ["region:in", OPEC.id], lastSeen: hoursAgo(10) });
    view();
    // Red Sea, freight and the draft match the profile (the draft is also news on India); OPEC moved 16 points.
    await waitFor(() => expect(screen.getByRole("heading", { name: "4 new for you" })).toBeTruthy());
    const alerts = screen.getByRole("region", { name: "4 new for you" });
    expect(within(alerts).getByText(/Matches your business and your watchlist/)).toBeTruthy();
    expect(within(alerts).getByText(/▲ 16 points in a day/)).toBeTruthy();
    // A probability always comes with its source, volume and last update.
    const move = within(alerts).getByText(/▲ 16 points in a day/).closest("button")!;
    expect(within(move).getByText("52K MANA volume")).toBeTruthy();
    expect(within(move).getByText(/Updated/)).toBeTruthy();
    // This visit is recorded for next time; today's alerts stay until marked as seen.
    expect(profileStore.stores.lastSeen.getState().value).toBe(new Date(NOW).toISOString());
    fireEvent.click(within(alerts).getByRole("button", { name: "Mark all as seen" }));
    expect(screen.getByText(/You're up to date/)).toBeTruthy();
  });

  it("shows the same count on the nav badge", async () => {
    seed({ watchlist: ["region:in", OPEC.id], lastSeen: hoursAgo(10) });
    render(<BusinessAlertBadge />, { wrapper });
    await waitFor(() => expect(screen.getByText("4")).toBeTruthy());
    expect(screen.getByText("new since your last visit")).toBeTruthy();
  });

  it("lists watched places with their latest activity", async () => {
    seed({ watchlist: ["region:in"], lastSeen: hoursAgo(10) });
    view();
    const list = screen.getByRole("region", { name: /^Watchlist/ });
    await waitFor(() => expect(within(list).getByText("India")).toBeTruthy());
    expect(within(list).getByText("1 new")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: /^India, region/ }));
    expect(top()).toEqual({ kind: "region", id: "region:in" });
  });
});
