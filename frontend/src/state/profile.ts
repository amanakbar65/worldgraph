/**
 * The viewer's business profile, watchlist, alert rules and last visit.
 *
 * Stored per viewer through the user store (platform/storage.ts), under the
 * same keys `useUserValue` uses: "profile", "watchlist", "alerts" and
 * "last-seen". In the test link that is the viewer's private subtree of the
 * Artifact's db (it follows them across devices); on the website, this
 * browser. Only ids, sector slugs and short keywords are kept: never a
 * name, an email or anything else personal.
 *
 * Each value lives in one shared store, so the onboarding, the feed and the
 * Opportunities screen always agree (separate `useUserValue` calls would each
 * hold their own copy). The pure helpers below (isEmpty, matches, alerts)
 * are tested on their own. Edits to the profile, watchlist and alert rules
 * join the viewer's undo list (state/undo.ts); the visit time does not.
 */
import { useEffect } from "react";
import { create } from "zustand";

import {
  SECTOR_IDS,
  type EntityType,
  type ForecastSummary,
  type Profile,
  type SectorId,
  type StorySummary,
} from "@/api/contract";
import { sectorLabel } from "@/lib/icons";

import { createStoredValue, useStored } from "./stored-value";
import { nameForLabel } from "./undo";

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

/** The lists of ids in a profile (sectors are slugs, the rest node ids). */
export const PROFILE_ROLES = [
  "sectors",
  "locations",
  "suppliers",
  "markets",
  "inputs",
  "competitors",
] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];
export type EntityRole = Exclude<ProfileRole, "sectors">;

export interface RoleInfo {
  /** Section label in the editor, e.g. "Where you buy from". */
  label: string;
  /** One word for chips, e.g. "Supplier". */
  short: string;
  /** For screen readers and sentences, e.g. "your supplier". */
  phrase: string;
  /** Which node types fit this list (what the search offers). */
  types: readonly EntityType[];
}

export const ROLE_INFO: Record<ProfileRole, RoleInfo> = {
  sectors: { label: "Sectors", short: "Sector", phrase: "your sector", types: ["sector"] },
  locations: { label: "Where you operate", short: "Base", phrase: "where you operate", types: ["region"] },
  suppliers: {
    label: "Where you buy from",
    short: "Supplier",
    phrase: "where you buy from",
    types: ["region", "organization"],
  },
  markets: { label: "Where you sell", short: "Market", phrase: "where you sell", types: ["region"] },
  inputs: {
    label: "Key inputs and routes",
    short: "Input",
    phrase: "your input",
    types: ["commodity", "infrastructure", "policy"],
  },
  competitors: {
    label: "Competitors to follow",
    short: "Competitor",
    phrase: "your competitor",
    types: ["organization"],
  },
};

export const emptyProfile: Profile = {
  name: null,
  sectors: [],
  locations: [],
  suppliers: [],
  markets: [],
  inputs: [],
  competitors: [],
  keywords: [],
};

/** Limits the database also applies: 50 ids per list, 20 keywords of 2–60 characters. */
export const MAX_IDS_PER_ROLE = 50;
export const MAX_KEYWORDS = 20;
export const KEYWORD_MIN = 2;
export const KEYWORD_MAX = 40;

const NODE_ID = /^[a-z_]+:[a-z0-9][a-z0-9.-]*$/;
const isSector = (s: unknown): s is SectorId =>
  typeof s === "string" && (SECTOR_IDS as readonly string[]).includes(s);

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && NODE_ID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_IDS_PER_ROLE) break;
  }
  return out;
}

/** A keyword as stored: trimmed, single-spaced, lowercase, no markup characters. */
export function cleanKeyword(raw: string): string | null {
  const k = raw
    .replace(/[<>{}[\]\\"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (k.length < KEYWORD_MIN || k.length > KEYWORD_MAX) return null;
  return k;
}

/**
 * A profile from storage, made safe: unknown keys dropped, ids checked,
 * duplicates removed, limits applied. `name` is never kept (nothing personal).
 */
export function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyProfile;
  const r = raw as Record<string, unknown>;
  const sectors = Array.isArray(r.sectors) ? [...new Set(r.sectors.filter(isSector))] : [];
  const keywords: string[] = [];
  if (Array.isArray(r.keywords)) {
    for (const k of r.keywords) {
      const clean = typeof k === "string" ? cleanKeyword(k) : null;
      if (clean && !keywords.includes(clean)) keywords.push(clean);
      if (keywords.length >= MAX_KEYWORDS) break;
    }
  }
  return {
    name: null,
    sectors,
    locations: idList(r.locations),
    suppliers: idList(r.suppliers),
    markets: idList(r.markets),
    inputs: idList(r.inputs),
    competitors: idList(r.competitors),
    keywords,
  };
}

/** True when the profile holds nothing to match on. */
export function isEmpty(profile: Profile): boolean {
  return PROFILE_ROLES.every((role) => profile[role].length === 0) && profile.keywords.length === 0;
}

/** How many things the profile holds (sectors, ids and keywords). */
export function profileSize(profile: Profile): number {
  return PROFILE_ROLES.reduce((n, role) => n + profile[role].length, 0) + profile.keywords.length;
}

/** Every node id in the profile (not sectors or keywords), each once. */
export function profileIds(profile: Profile): string[] {
  const out: string[] = [];
  for (const role of PROFILE_ROLES) {
    if (role === "sectors") continue;
    for (const id of profile[role]) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The profile's places: where you operate, buy and sell. */
export function profilePlaces(profile: Profile): string[] {
  return [...new Set([...profile.locations, ...profile.suppliers, ...profile.markets])].filter((id) =>
    id.startsWith("region:"),
  );
}

/**
 * Which lists hold this id. Sector nodes ("sector:energy") count as the
 * sector slug, which is how api.affects reports a sector match.
 */
export function rolesOf(id: string, profile: Profile): ProfileRole[] {
  if (id.startsWith("sector:")) {
    const slug = id.slice("sector:".length);
    return isSector(slug) && profile.sectors.includes(slug) ? ["sectors"] : [];
  }
  return PROFILE_ROLES.filter((role) => role !== "sectors" && (profile[role] as string[]).includes(id));
}

/** Add an id to a list (no duplicates, within the limit). */
export function addToProfile(profile: Profile, role: EntityRole, id: string): Profile {
  const list = profile[role];
  if (list.includes(id) || list.length >= MAX_IDS_PER_ROLE || !NODE_ID.test(id)) return profile;
  return { ...profile, [role]: [...list, id] };
}

export function removeFromProfile(profile: Profile, role: EntityRole, id: string): Profile {
  return { ...profile, [role]: profile[role].filter((x) => x !== id) };
}

export function toggleSector(profile: Profile, sector: SectorId): Profile {
  return {
    ...profile,
    sectors: profile.sectors.includes(sector)
      ? profile.sectors.filter((s) => s !== sector)
      : [...profile.sectors, sector],
  };
}

export function addKeyword(profile: Profile, raw: string): Profile {
  const k = cleanKeyword(raw);
  if (!k || profile.keywords.includes(k) || profile.keywords.length >= MAX_KEYWORDS) return profile;
  return { ...profile, keywords: [...profile.keywords, k] };
}

export function removeKeyword(profile: Profile, keyword: string): Profile {
  return { ...profile, keywords: profile.keywords.filter((k) => k !== keyword) };
}

/** Is region `inner` the same place as `outer` or inside it (a state's city)? */
export function regionWithin(inner: string, outer: string): boolean {
  return (
    inner === outer ||
    inner.startsWith(`${outer}.`) ||
    (outer.split("-").length === 1 && inner.startsWith(`${outer}-`))
  );
}

/** One reason a story touches the profile. */
export type MatchReason =
  | { kind: "sector"; sector: SectorId }
  | { kind: "place"; role: "locations" | "suppliers" | "markets"; id: string }
  | { kind: "keyword"; keyword: string };

/** Does `text` contain `keyword` as a whole word or phrase (any case)? */
export function hasKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(s|es)?($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/**
 * Why a story touches the profile, from what the story card itself carries:
 * shared sectors, its place inside one of your places, and your keywords in
 * its headline or so-what. Empty means no visible match. (api.affects also
 * follows the entities a story mentions and causal links; this is the
 * part the browser can check on its own.)
 */
export function matches(
  profile: Profile,
  story: Pick<StorySummary, "sectors" | "region" | "headline" | "so_what">,
): MatchReason[] {
  const reasons: MatchReason[] = [];
  for (const sector of story.sectors)
    if (profile.sectors.includes(sector)) reasons.push({ kind: "sector", sector });
  const region = story.region;
  if (region) {
    for (const role of ["locations", "suppliers", "markets"] as const) {
      for (const id of profile[role]) {
        if (!id.startsWith("region:")) continue;
        if (regionWithin(region.id, id) || region.country_id === id) {
          if (!reasons.some((r) => r.kind === "place" && r.id === id))
            reasons.push({ kind: "place", role, id });
        }
      }
    }
  }
  const text = `${story.headline} ${story.so_what ?? ""}`;
  for (const keyword of profile.keywords)
    if (hasKeyword(text, keyword)) reasons.push({ kind: "keyword", keyword });
  return reasons;
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export const MAX_WATCH = 40;

/** Watched node ids (regions, entities and forecasts), newest last. */
export function normalizeWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && NODE_ID.test(v) && !v.startsWith("story:") && !out.includes(v)) out.push(v);
  }
  return out.slice(-MAX_WATCH);
}

export function toggleWatch(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : normalizeWatchlist([...list, id]);
}

// ---------------------------------------------------------------------------
// Alert rules and alerts
// ---------------------------------------------------------------------------

export interface AlertRules {
  /** New stories that match your profile. */
  profile: boolean;
  /** New stories about what's on your watchlist. */
  watchlist: boolean;
  /** Watched crowd forecasts: big daily moves and the thresholds below. */
  forecasts: boolean;
  /** A watched forecast moving at least this many points in a day is an alert. */
  forecastMove: 5 | 10 | 20;
  /** Per watched forecast: tell me when it crosses this probability (0..1). */
  thresholds: Record<string, number>;
}

export const DEFAULT_ALERT_RULES: AlertRules = {
  profile: true,
  watchlist: true,
  forecasts: true,
  forecastMove: 10,
  thresholds: {},
};

const MOVES: readonly AlertRules["forecastMove"][] = [5, 10, 20];

export function normalizeAlertRules(raw: unknown): AlertRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_ALERT_RULES;
  const r = raw as Record<string, unknown>;
  const thresholds: Record<string, number> = {};
  if (r.thresholds && typeof r.thresholds === "object" && !Array.isArray(r.thresholds)) {
    for (const [id, t] of Object.entries(r.thresholds as Record<string, unknown>)) {
      if (id.startsWith("forecast:") && NODE_ID.test(id) && typeof t === "number" && t > 0 && t < 1) {
        thresholds[id] = Math.round(t * 100) / 100;
      }
    }
  }
  return {
    profile: typeof r.profile === "boolean" ? r.profile : DEFAULT_ALERT_RULES.profile,
    watchlist: typeof r.watchlist === "boolean" ? r.watchlist : DEFAULT_ALERT_RULES.watchlist,
    forecasts: typeof r.forecasts === "boolean" ? r.forecasts : DEFAULT_ALERT_RULES.forecasts,
    forecastMove: MOVES.includes(r.forecastMove as AlertRules["forecastMove"])
      ? (r.forecastMove as AlertRules["forecastMove"])
      : DEFAULT_ALERT_RULES.forecastMove,
    thresholds,
  };
}

export type Alert =
  | {
      kind: "story";
      story: StorySummary;
      /** Matched your profile (api.affects), your watchlist, or both. */
      profile: boolean;
      /** Watched ids whose news this is. */
      watchIds: string[];
    }
  | { kind: "forecast-move"; forecast: ForecastSummary; points: number }
  | { kind: "forecast-threshold"; forecast: ForecastSummary; threshold: number; direction: "up" | "down" };

export interface AlertInput {
  /** The last visit (ISO); null on the first visit, which has no alerts yet. */
  since: string | null;
  rules: AlertRules;
  /** Stories that match the profile (api.affects items). */
  profileStories: readonly StorySummary[];
  /** Recent stories about watched things, with the watched id each belongs to. */
  watchStories: readonly { watchId: string; story: StorySummary }[];
  /** Watched crowd forecasts. */
  forecasts: readonly ForecastSummary[];
}

const after = (iso: string | null | undefined, since: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t > since;
};

/** Did the probability cross `threshold` in the last 24 hours, and which way? */
export function crossedThreshold(
  probability: number,
  change24h: number | null,
  threshold: number,
): "up" | "down" | null {
  if (change24h === null) return null;
  const before = probability - change24h;
  if (before < threshold && probability >= threshold) return "up";
  if (before >= threshold && probability < threshold) return "down";
  return null;
}

/**
 * Simple in-app alerts: what's new since the last visit.
 * - stories first seen after the last visit that match the profile or
 *   something watched (each story once);
 * - watched crowd forecasts updated since then that moved at least the
 *   chosen number of points in a day, or crossed the viewer's threshold.
 * Newest stories first, then forecasts by size of move.
 */
export function collectAlerts(input: AlertInput): Alert[] {
  if (!input.since) return [];
  const since = Date.parse(input.since);
  if (Number.isNaN(since)) return [];
  const { rules } = input;

  const stories = new Map<string, Extract<Alert, { kind: "story" }>>();
  if (rules.profile) {
    for (const story of input.profileStories) {
      if (story.kind !== "event" || !after(story.first_seen, since) || stories.has(story.id)) continue;
      stories.set(story.id, { kind: "story", story, profile: true, watchIds: [] });
    }
  }
  if (rules.watchlist) {
    for (const { watchId, story } of input.watchStories) {
      if (story.kind !== "event" || !after(story.first_seen, since)) continue;
      const existing = stories.get(story.id);
      if (existing) {
        if (!existing.watchIds.includes(watchId)) existing.watchIds.push(watchId);
      } else stories.set(story.id, { kind: "story", story, profile: false, watchIds: [watchId] });
    }
  }
  const storyAlerts = [...stories.values()].sort(
    (a, b) =>
      Date.parse(b.story.first_seen ?? "") - Date.parse(a.story.first_seen ?? "") ||
      a.story.id.localeCompare(b.story.id),
  );

  const forecastAlerts: Alert[] = [];
  if (rules.forecasts) {
    const seen = new Set<string>();
    for (const forecast of input.forecasts) {
      if (seen.has(forecast.id) || !after(forecast.updated_at, since)) continue;
      seen.add(forecast.id);
      const threshold = rules.thresholds[forecast.id];
      const crossed =
        threshold === undefined
          ? null
          : crossedThreshold(forecast.probability, forecast.change_24h, threshold);
      if (crossed && threshold !== undefined) {
        forecastAlerts.push({ kind: "forecast-threshold", forecast, threshold, direction: crossed });
        continue;
      }
      const points = Math.round((forecast.change_24h ?? 0) * 100);
      if (Math.abs(points) >= rules.forecastMove)
        forecastAlerts.push({ kind: "forecast-move", forecast, points });
    }
    forecastAlerts.sort((a, b) => moveSize(b) - moveSize(a));
  }
  return [...storyAlerts, ...forecastAlerts];
}

function moveSize(alert: Alert): number {
  return alert.kind === "story"
    ? 0
    : Math.abs(alert.forecast.change_24h ?? 0) + (alert.kind === "forecast-threshold" ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Shared stored values
// ---------------------------------------------------------------------------

export type { StoredValue } from "./stored-value";

/** How a profile edit reads in the undo list: "added Gujarat to where you buy from". */
export function describeProfileChange(before: Profile, after: Profile): string {
  const changed = [...PROFILE_ROLES, "keywords" as const].filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  if (changed.length !== 1) return "profile changes";
  const role = changed[0];
  const was = before[role] as string[];
  const now = after[role] as string[];
  const added = now.filter((x) => !was.includes(x));
  const removed = was.filter((x) => !now.includes(x));
  const one = added.length + removed.length === 1 ? (added[0] ?? removed[0]) : null;
  if (!one) return role === "keywords" ? "keywords" : `${ROLE_INFO[role].label.toLowerCase()}`;
  const verb = added.length ? "added" : "removed";
  const to = added.length ? "to" : "from";
  if (role === "keywords") return `${verb} keyword "${one}"`;
  if (role === "sectors") return `${verb} ${sectorLabel(one as SectorId)} ${to} your sectors`;
  return `${verb} ${nameForLabel(one)} ${to} ${ROLE_INFO[role].label.toLowerCase()}`;
}

/** "added Gujarat to your watchlist" (or "watchlist changes"). */
export function describeWatchChange(before: string[], after: string[]): string {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  if (added.length + removed.length !== 1) return "watchlist changes";
  return added.length
    ? `added ${nameForLabel(added[0])} to your watchlist`
    : `removed ${nameForLabel(removed[0])} from your watchlist`;
}

/** "alert threshold" or "alert settings". */
export function describeRulesChange(before: AlertRules, after: AlertRules): string {
  const onlyThresholds =
    JSON.stringify({ ...before, thresholds: null }) === JSON.stringify({ ...after, thresholds: null });
  return onlyThresholds ? "forecast alert threshold" : "alert settings";
}

const profileValue = createStoredValue<Profile>("profile", emptyProfile, normalizeProfile, {
  key: "profile",
  describe: describeProfileChange,
});
const watchValue = createStoredValue<string[]>("watchlist", [], normalizeWatchlist, {
  key: "watchlist",
  describe: describeWatchChange,
});
const rulesValue = createStoredValue<AlertRules>("alerts", DEFAULT_ALERT_RULES, normalizeAlertRules, {
  key: "alerts",
  describe: describeRulesChange,
});
// The visit time is housekeeping, not an edit: it stays out of undo.
const lastSeenValue = createStoredValue<string | null>("last-seen", null, (raw) =>
  typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? raw : null,
);

/** The business profile (shared by every screen). */
export const useProfile = () => useStored(profileValue);
/** Watched ids: regions, entities and forecasts. */
export const useWatchlist = () => useStored(watchValue);
/** The viewer's alert rules. */
export const useAlertRules = () => useStored(rulesValue);

// ---------------------------------------------------------------------------
// Last visit
// ---------------------------------------------------------------------------

/**
 * "Since your last visit": the baseline is the stored visit time as it was
 * when this page loaded, so alerts stay put while the viewer reads them.
 * Opening My Business records the new visit for next time; "Mark all as
 * seen" moves the baseline to now.
 */
const useBaseline = create<{ since: string | null; captured: boolean }>(() => ({
  since: null,
  captured: false,
}));

export function useLastVisit(): {
  /** The last visit before this one (null on the first visit or while loading). */
  since: string | null;
  loaded: boolean;
  /** Record this visit (for next time) without clearing today's alerts. */
  recordVisit: () => void;
  /** Clear the alerts: the baseline becomes now. */
  markSeen: () => void;
} {
  const stored = useStored(lastSeenValue);
  const baseline = useBaseline();
  useEffect(() => {
    if (stored.loaded && !baseline.captured) useBaseline.setState({ since: stored.value, captured: true });
  }, [stored.loaded, stored.value, baseline.captured]);
  return {
    since: baseline.captured ? baseline.since : null,
    loaded: baseline.captured,
    recordVisit: () => {
      if (!lastSeenValue.store.getState().loaded) return;
      lastSeenValue.store.getState().set(new Date().toISOString());
    },
    markSeen: () => {
      const now = new Date().toISOString();
      useBaseline.setState({ since: now, captured: true });
      lastSeenValue.store.getState().set(now);
    },
  };
}

/** Tests only: forget everything loaded in this module. */
export const __testing = {
  reset: () => {
    profileValue.reset();
    watchValue.reset();
    rulesValue.reset();
    lastSeenValue.reset();
    useBaseline.setState({ since: null, captured: false });
  },
  stores: {
    profile: profileValue.store,
    watchlist: watchValue.store,
    rules: rulesValue.store,
    lastSeen: lastSeenValue.store,
  },
};
