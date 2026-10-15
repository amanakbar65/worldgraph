import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForecastSummary, Profile, StorySummary } from "@/api/contract";
import { __testing as storage } from "@/platform/storage";

import {
  __testing,
  addKeyword,
  addToProfile,
  cleanKeyword,
  collectAlerts,
  crossedThreshold,
  DEFAULT_ALERT_RULES,
  emptyProfile,
  hasKeyword,
  isEmpty,
  matches,
  MAX_IDS_PER_ROLE,
  MAX_KEYWORDS,
  MAX_WATCH,
  normalizeAlertRules,
  normalizeProfile,
  normalizeWatchlist,
  profileIds,
  profilePlaces,
  profileSize,
  regionWithin,
  removeFromProfile,
  removeKeyword,
  rolesOf,
  toggleSector,
  toggleWatch,
  useLastVisit,
  useProfile,
  useWatchlist,
  type AlertInput,
} from "./profile";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const PROFILE: Profile = {
  name: null,
  sectors: ["manufacturing", "logistics-trade"],
  locations: ["region:in-gj"],
  suppliers: ["region:cn", "org:foxconn"],
  markets: ["region:us"],
  inputs: ["commodity:cotton", "infra:bab-el-mandeb"],
  competitors: ["org:arvind"],
  keywords: ["freight", "cold chain"],
};

function story(partial: Partial<StorySummary> & Pick<StorySummary, "id">): StorySummary {
  return {
    kind: "event",
    headline: "A headline",
    so_what: null,
    event_type: "policy",
    impact: "risk",
    direction: "up",
    magnitude: 3,
    horizon: "weeks",
    confidence: 0.7,
    importance: 60,
    sectors: [],
    first_seen: hoursAgo(1),
    region: null,
    lon: null,
    lat: null,
    source_count: 3,
    analysed: true,
    is_sample: false,
    ...partial,
  };
}

function forecast(partial: Partial<ForecastSummary> & Pick<ForecastSummary, "id">): ForecastSummary {
  return {
    short_title: "Will it happen?",
    question: "Will it happen?",
    category: "economy",
    probability: 0.5,
    change_24h: 0,
    volume: 1000,
    volume_unit: "MANA",
    liquidity: 100,
    thin: false,
    end_date: null,
    updated_at: hoursAgo(0.5),
    provider: "manifold",
    provider_name: "Manifold",
    url: null,
    region: null,
    lon: null,
    lat: null,
    sparkline: [],
    is_sample: false,
    ...partial,
  };
}

describe("the profile", () => {
  it("cleans what it reads from storage, keeps nothing personal and applies the limits", () => {
    const raw = {
      name: "Asha Textiles",
      email: "someone@example.com",
      sectors: ["energy", "space-tourism", "energy"],
      locations: ["region:in-gj", "Gujarat", "region:in-gj", 7],
      suppliers: Array.from({ length: MAX_IDS_PER_ROLE + 5 }, (_, i) => `region:x${i}`),
      markets: "region:us",
      inputs: ["commodity:cotton"],
      keywords: ["  Cold   Chain ", "<b>x</b>", "a", "cold chain", "Freight"],
    };
    const p = normalizeProfile(raw);
    expect(p.name).toBeNull();
    expect(Object.keys(p).sort()).toEqual(Object.keys(emptyProfile).sort());
    expect(p.sectors).toEqual(["energy"]);
    expect(p.locations).toEqual(["region:in-gj"]);
    expect(p.suppliers).toHaveLength(MAX_IDS_PER_ROLE);
    expect(p.markets).toEqual([]);
    expect(p.competitors).toEqual([]);
    expect(p.keywords).toEqual(["cold chain", "b x /b", "freight"]);
    expect(normalizeProfile(null)).toEqual(emptyProfile);
    expect(normalizeProfile([1, 2])).toEqual(emptyProfile);
  });

  it("knows when it is empty and how big it is", () => {
    expect(isEmpty(emptyProfile)).toBe(true);
    expect(isEmpty({ ...emptyProfile, keywords: ["freight"] })).toBe(false);
    expect(isEmpty({ ...emptyProfile, sectors: ["energy"] })).toBe(false);
    expect(profileSize(PROFILE)).toBe(2 + 1 + 2 + 1 + 2 + 1 + 2);
  });

  it("lists its ids and places", () => {
    expect(profileIds(PROFILE)).toEqual([
      "region:in-gj",
      "region:cn",
      "org:foxconn",
      "region:us",
      "commodity:cotton",
      "infra:bab-el-mandeb",
      "org:arvind",
    ]);
    expect(profilePlaces(PROFILE)).toEqual(["region:in-gj", "region:cn", "region:us"]);
  });

  it("says which lists hold an id, sector nodes included", () => {
    expect(rolesOf("region:cn", PROFILE)).toEqual(["suppliers"]);
    expect(rolesOf("sector:manufacturing", PROFILE)).toEqual(["sectors"]);
    expect(rolesOf("sector:energy", PROFILE)).toEqual([]);
    expect(rolesOf("region:de", PROFILE)).toEqual([]);
    const both = addToProfile(PROFILE, "markets", "region:cn");
    expect(rolesOf("region:cn", both)).toEqual(["suppliers", "markets"]);
  });

  it("adds and removes ids without duplicates or bad ids", () => {
    const p = addToProfile(emptyProfile, "inputs", "commodity:wheat");
    expect(p.inputs).toEqual(["commodity:wheat"]);
    expect(addToProfile(p, "inputs", "commodity:wheat")).toBe(p);
    expect(addToProfile(p, "inputs", "Wheat")).toBe(p);
    expect(removeFromProfile(p, "inputs", "commodity:wheat").inputs).toEqual([]);
    const full = { ...emptyProfile, inputs: Array.from({ length: MAX_IDS_PER_ROLE }, (_, i) => `commodity:c${i}`) };
    expect(addToProfile(full, "inputs", "commodity:one-more")).toBe(full);
  });

  it("toggles sectors and keeps keywords short and tidy", () => {
    expect(toggleSector(emptyProfile, "tech").sectors).toEqual(["tech"]);
    expect(toggleSector({ ...emptyProfile, sectors: ["tech"] }, "tech").sectors).toEqual([]);
    expect(cleanKeyword("  Cotton   YARN ")).toBe("cotton yarn");
    expect(cleanKeyword("x")).toBeNull();
    expect(cleanKeyword("a".repeat(41))).toBeNull();
    const k = addKeyword(emptyProfile, "Cotton yarn");
    expect(k.keywords).toEqual(["cotton yarn"]);
    expect(addKeyword(k, "COTTON YARN")).toBe(k);
    expect(removeKeyword(k, "cotton yarn").keywords).toEqual([]);
    const many = { ...emptyProfile, keywords: Array.from({ length: MAX_KEYWORDS }, (_, i) => `word ${i}`) };
    expect(addKeyword(many, "one more")).toBe(many);
  });
});

describe("matching a story to the profile", () => {
  it("knows which places sit inside which", () => {
    expect(regionWithin("region:in-gj", "region:in")).toBe(true);
    expect(regionWithin("region:in-gj.ahmedabad", "region:in-gj")).toBe(true);
    expect(regionWithin("region:in", "region:in")).toBe(true);
    expect(regionWithin("region:ind", "region:in")).toBe(false);
    expect(regionWithin("region:in-gj-x", "region:in-gj")).toBe(false);
    expect(regionWithin("region:in", "region:in-gj")).toBe(false);
  });

  it("finds keywords as whole words, in any case, with simple plurals", () => {
    expect(hasKeyword("Freight rates jump", "freight")).toBe(true);
    expect(hasKeyword("Cold-chain firms: more cold  chains", "cold chain")).toBe(true);
    expect(hasKeyword("Airfreight demand", "freight")).toBe(false);
    expect(hasKeyword("Port fees (a.k.a. charges)", "a.k.a")).toBe(true);
  });

  it("gives every reason a story touches the profile", () => {
    const s = story({
      id: "story:x",
      headline: "Freight costs rise for Gujarat mills",
      sectors: ["manufacturing", "energy"],
      region: { id: "region:in-gj.surat", name: "Surat", subtype: "city", country_id: "region:in" },
    });
    expect(matches(PROFILE, s)).toEqual([
      { kind: "sector", sector: "manufacturing" },
      { kind: "place", role: "locations", id: "region:in-gj" },
      { kind: "keyword", keyword: "freight" },
    ]);
    const china = story({
      id: "story:y",
      region: { id: "region:cn-gd.shenzhen", name: "Shenzhen", subtype: "city", country_id: "region:cn" },
    });
    expect(matches(PROFILE, china)).toEqual([{ kind: "place", role: "suppliers", id: "region:cn" }]);
    expect(matches(emptyProfile, s)).toEqual([]);
  });
});

describe("the watchlist", () => {
  it("keeps valid ids once, never stories, newest last, up to the limit", () => {
    expect(normalizeWatchlist(["region:in", "story:x", "region:in", "Bad id", 3, "forecast:fed"])).toEqual([
      "region:in",
      "forecast:fed",
    ]);
    const long = Array.from({ length: MAX_WATCH + 3 }, (_, i) => `region:r${i}`);
    expect(normalizeWatchlist(long)).toEqual(long.slice(3));
    expect(normalizeWatchlist("region:in")).toEqual([]);
  });

  it("toggles an id on and off", () => {
    expect(toggleWatch([], "region:in")).toEqual(["region:in"]);
    expect(toggleWatch(["region:in"], "region:in")).toEqual([]);
  });
});

describe("alert rules", () => {
  it("falls back to the defaults for anything unreadable", () => {
    expect(normalizeAlertRules(undefined)).toEqual(DEFAULT_ALERT_RULES);
    expect(
      normalizeAlertRules({
        profile: false,
        watchlist: "yes",
        forecastMove: 7,
        thresholds: { "forecast:fed": 0.456, "region:in": 0.5, "forecast:zero": 0, "forecast:odd": "0.5" },
      }),
    ).toEqual({
      ...DEFAULT_ALERT_RULES,
      profile: false,
      thresholds: { "forecast:fed": 0.46 },
    });
  });

  it("knows when a forecast crossed a level in the last day", () => {
    expect(crossedThreshold(0.62, 0.15, 0.5)).toBe("up");
    expect(crossedThreshold(0.42, -0.1, 0.5)).toBe("down");
    expect(crossedThreshold(0.62, 0.05, 0.5)).toBeNull();
    expect(crossedThreshold(0.62, null, 0.5)).toBeNull();
  });
});

describe("alerts since the last visit", () => {
  const since = hoursAgo(10);
  const fresh = story({ id: "story:fresh", first_seen: hoursAgo(2) });
  const older = story({ id: "story:older", first_seen: hoursAgo(12) });
  const fresher = story({ id: "story:fresher", first_seen: hoursAgo(1) });
  const projected = story({ id: "story:proj", kind: "projected", first_seen: null });
  const input = (patch: Partial<AlertInput> = {}): AlertInput => ({
    since,
    rules: DEFAULT_ALERT_RULES,
    profileStories: [fresh, older, projected],
    watchStories: [
      { watchId: "region:in", story: fresher },
      { watchId: "commodity:cotton", story: fresh },
      { watchId: "region:in", story: older },
    ],
    forecasts: [],
    ...patch,
  });

  it("has nothing to say on the first visit", () => {
    expect(collectAlerts(input({ since: null }))).toEqual([]);
    expect(collectAlerts(input({ since: "not a date" }))).toEqual([]);
  });

  it("counts each new story once, newest first, and says why", () => {
    const alerts = collectAlerts(input());
    expect(alerts.map((a) => (a.kind === "story" ? a.story.id : a.kind))).toEqual(["story:fresher", "story:fresh"]);
    expect(alerts[0]).toMatchObject({ profile: false, watchIds: ["region:in"] });
    expect(alerts[1]).toMatchObject({ profile: true, watchIds: ["commodity:cotton"] });
  });

  it("follows the viewer's rules", () => {
    const rules = { ...DEFAULT_ALERT_RULES, profile: false };
    expect(collectAlerts(input({ rules })).map((a) => (a.kind === "story" ? a.story.id : ""))).toEqual([
      "story:fresher",
      "story:fresh",
    ]);
    const noWatch = { ...DEFAULT_ALERT_RULES, watchlist: false };
    expect(collectAlerts(input({ rules: noWatch }))).toHaveLength(1);
    const neither = { ...DEFAULT_ALERT_RULES, watchlist: false, profile: false };
    expect(collectAlerts(input({ rules: neither }))).toEqual([]);
  });

  it("flags big daily moves and crossed levels in watched forecasts updated since", () => {
    const big = forecast({ id: "forecast:big", probability: 0.7, change_24h: 0.12 });
    const small = forecast({ id: "forecast:small", probability: 0.4, change_24h: 0.04 });
    const crossed = forecast({ id: "forecast:crossed", probability: 0.55, change_24h: 0.06 });
    const stale = forecast({ id: "forecast:stale", change_24h: 0.3, updated_at: hoursAgo(20) });
    const rules = { ...DEFAULT_ALERT_RULES, thresholds: { "forecast:crossed": 0.5 } };
    const alerts = collectAlerts(input({ profileStories: [], watchStories: [], rules, forecasts: [big, small, crossed, stale, big] }));
    expect(alerts).toEqual([
      { kind: "forecast-threshold", forecast: crossed, threshold: 0.5, direction: "up" },
      { kind: "forecast-move", forecast: big, points: 12 },
    ]);
    const quiet = collectAlerts(
      input({ profileStories: [], watchStories: [], forecasts: [big], rules: { ...rules, forecastMove: 20 } }),
    );
    expect(quiet).toEqual([]);
    const off = collectAlerts(input({ profileStories: [], watchStories: [], forecasts: [big], rules: { ...rules, forecasts: false } }));
    expect(off).toEqual([]);
  });
});

describe("stored values", () => {
  beforeEach(() => {
    localStorage.clear();
    storage.reset();
    __testing.reset();
  });
  afterEach(() => vi.useRealTimers());

  it("loads the profile from this browser, cleaned, and saves changes back", async () => {
    localStorage.setItem("worldgraph.user.profile", JSON.stringify({ ...PROFILE, name: "Someone" }));
    const { result } = renderHook(() => useProfile());
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.kind).toBe("browser");
    expect(result.current.value).toEqual(PROFILE);
    act(() => result.current.set((p) => addKeyword(p, "Tariffs")));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("worldgraph.user.profile") ?? "{}").keywords).toContain("tariffs"),
    );
  });

  it("shares one copy between screens", async () => {
    const a = renderHook(() => useWatchlist());
    const b = renderHook(() => useWatchlist());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    act(() => a.result.current.set((l) => toggleWatch(l, "region:in")));
    expect(b.result.current.value).toEqual(["region:in"]);
  });

  it("keeps today's baseline while recording this visit; 'mark as seen' moves it to now", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const last = hoursAgo(30);
    localStorage.setItem("worldgraph.user.last-seen", JSON.stringify(last));
    const { result } = renderHook(() => useLastVisit());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.since).toBe(last);
    act(() => result.current.recordVisit());
    expect(result.current.since).toBe(last);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("worldgraph.user.last-seen") ?? "null")).toBe(new Date(NOW).toISOString()));
    act(() => result.current.markSeen());
    expect(result.current.since).toBe(new Date(NOW).toISOString());
  });

  it("has no baseline on the first visit", async () => {
    const { result } = renderHook(() => useLastVisit());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.since).toBeNull();
  });
});
