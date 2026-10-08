import { create } from "zustand";

import { SECTOR_IDS, type SectorId, type TimeWindow } from "@/api/contract";

/** Top-level screens. */
export const VIEWS = ["globe", "graph", "forecasts", "opportunities", "business", "brief"] as const;
export type View = (typeof VIEWS)[number];

/** Things that open on top of a screen: side panel on desktop, bottom sheet on mobile. */
export type Panel =
  | { kind: "region"; id: string }
  | { kind: "story"; id: string }
  | { kind: "cascade"; id: string } // opens full width
  | { kind: "entity"; id: string }
  | { kind: "forecast"; id: string }
  | { kind: "compare"; ids: string[] }
  | { kind: "ask"; q?: string; scope?: string }
  | { kind: "settings" };

interface NavState {
  view: View;
  /** Panel history; the last one is shown. Back pops it. */
  panels: Panel[];
  window: TimeWindow;
  sectors: SectorId[]; // empty = all sectors (lens off)
  /** A camera request for the globe: fly to this region or point. */
  focus: { regionId?: string; lon?: number; lat?: number; zoom?: number; nonce: number } | null;
  setView: (view: View) => void;
  open: (panel: Panel) => void;
  replace: (panel: Panel) => void;
  back: () => void;
  closePanels: () => void;
  setWindow: (window: TimeWindow) => void;
  toggleSector: (sector: SectorId) => void;
  clearSectors: () => void;
  flyTo: (focus: Omit<NonNullable<NavState["focus"]>, "nonce">) => void;
}

const samePanel = (a: Panel, b: Panel) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Deep links: the view, the top panel, the window and the sector lens live in
// the URL hash (only bare #anchors survive inside claude.ai), e.g.
//   #globe   #story=story:abc   #region=region:in-gj&w=24h   #graph&s=energy
// ---------------------------------------------------------------------------

/** The part of the navigation state that a link carries. */
export interface LinkState {
  view: View;
  panel: Panel | null;
  window: TimeWindow;
  sectors: SectorId[];
}

const DEFAULT_VIEW: View = "globe";
const DEFAULT_WINDOW: TimeWindow = "7d";
const WINDOWS: readonly TimeWindow[] = ["24h", "7d", "30d"];
const NODE_ID = /^[a-z_]+:[a-z0-9][a-z0-9.-]*$/;
const ID_PANELS = ["region", "story", "cascade", "entity", "forecast"] as const;
type IdPanelKind = (typeof ID_PANELS)[number];

const isView = (v: string): v is View => (VIEWS as readonly string[]).includes(v);
const isIdPanel = (k: string): k is IdPanelKind => (ID_PANELS as readonly string[]).includes(k);
const isSector = (s: string): s is SectorId => (SECTOR_IDS as readonly string[]).includes(s);

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Encode free text (an Ask question) but keep ids readable. */
const encodeText = (text: string) => encodeURIComponent(text).replace(/%20/g, "+");
const decodeText = (text: string) => decode(text.replace(/\+/g, "%20"));

/**
 * Read a hash like "#region=region:in-gj&w=24h". Unknown or malformed parts
 * are ignored; returns null when the hash holds nothing we recognise (for
 * example "#main" from the skip link), so the app keeps its state.
 */
export function parseHash(hash: string): LinkState | null {
  const body = hash.replace(/^#/, "").trim();
  if (!body) return null;
  const state: LinkState = { view: DEFAULT_VIEW, panel: null, window: DEFAULT_WINDOW, sectors: [] };
  let recognised = false;
  let ask: { q?: string; scope?: string } | null = null;
  for (const part of body.split("&")) {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    const raw = eq === -1 ? "" : part.slice(eq + 1);
    if (eq === -1 && isView(key)) {
      state.view = key;
      recognised = true;
    } else if (key === "w" && (WINDOWS as readonly string[]).includes(raw)) {
      state.window = raw as TimeWindow;
      recognised = true;
    } else if (key === "s") {
      state.sectors = [...new Set(raw.split(",").filter(isSector))];
      recognised = true;
    } else if (isIdPanel(key)) {
      const id = decode(raw);
      if (id && NODE_ID.test(id)) {
        state.panel = { kind: key, id };
        recognised = true;
      }
    } else if (key === "compare") {
      const ids = raw
        .split(",")
        .map(decode)
        .filter((id): id is string => !!id && NODE_ID.test(id));
      if (ids.length >= 2) {
        state.panel = { kind: "compare", ids: [...new Set(ids)].slice(0, 3) };
        recognised = true;
      }
    } else if (key === "settings" && eq === -1) {
      state.panel = { kind: "settings" };
      recognised = true;
    } else if (key === "ask") {
      const q = eq === -1 ? null : decodeText(raw);
      ask = { ...(ask ?? {}), ...(q ? { q: q.slice(0, 300) } : {}) };
      recognised = true;
    } else if (key === "scope") {
      const scope = decode(raw);
      if (scope && NODE_ID.test(scope)) ask = { ...(ask ?? {}), scope };
    }
  }
  if (ask && !state.panel) state.panel = { kind: "ask", ...ask };
  return recognised ? state : null;
}

function panelPart(panel: Panel): string {
  switch (panel.kind) {
    case "compare":
      return `compare=${panel.ids.join(",")}`;
    case "settings":
      return "settings";
    case "ask": {
      const parts = [panel.q ? `ask=${encodeText(panel.q)}` : "ask"];
      if (panel.scope) parts.push(`scope=${panel.scope}`);
      return parts.join("&");
    }
    default:
      return `${panel.kind}=${panel.id}`;
  }
}

/** Write the link state as a hash (with "#"); the plain globe is "#globe". */
export function formatHash(state: LinkState): string {
  const parts: string[] = [];
  if (state.view !== DEFAULT_VIEW || !state.panel) parts.push(state.view);
  if (state.panel) parts.push(panelPart(state.panel));
  if (state.window !== DEFAULT_WINDOW) parts.push(`w=${state.window}`);
  if (state.sectors.length) parts.push(`s=${state.sectors.join(",")}`);
  return `#${parts.join("&")}`;
}

/** The link state of the store right now. */
export function linkStateOf(s: Pick<NavState, "view" | "panels" | "window" | "sectors">): LinkState {
  return { view: s.view, panel: s.panels[s.panels.length - 1] ?? null, window: s.window, sectors: s.sectors };
}

function initialFromLocation(): Partial<Pick<NavState, "view" | "panels" | "window" | "sectors">> {
  try {
    const link = parseHash(window.location.hash);
    if (!link) return {};
    return {
      view: link.view,
      panels: link.panel ? [link.panel] : [],
      window: link.window,
      sectors: link.sectors,
    };
  } catch {
    return {};
  }
}

export const useNav = create<NavState>((set) => ({
  view: "globe",
  panels: [],
  window: "7d",
  sectors: [],
  focus: null,
  ...initialFromLocation(),
  setView: (view) => set({ view }),
  open: (panel) =>
    set((s) => {
      const top = s.panels[s.panels.length - 1];
      if (top && samePanel(top, panel)) return s;
      return { panels: [...s.panels.slice(-15), panel] };
    }),
  replace: (panel) => set((s) => ({ panels: [...s.panels.slice(0, -1), panel] })),
  back: () => set((s) => ({ panels: s.panels.slice(0, -1) })),
  closePanels: () => set({ panels: [] }),
  setWindow: (window) => set({ window }),
  toggleSector: (sector) =>
    set((s) => ({
      sectors: s.sectors.includes(sector) ? s.sectors.filter((x) => x !== sector) : [...s.sectors, sector],
    })),
  clearSectors: () => set({ sectors: [] }),
  flyTo: (focus) => set({ focus: { ...focus, nonce: Date.now() } }),
}));

export const currentPanel = (s: NavState): Panel | null => s.panels[s.panels.length - 1] ?? null;

/** Apply a link to the store, keeping the panel history when the link points back into it. */
export function applyLink(link: LinkState): void {
  useNav.setState((s) => {
    let panels = s.panels;
    if (!link.panel) panels = [];
    else {
      const top = panels[panels.length - 1];
      if (!top || !samePanel(top, link.panel)) {
        let at = -1;
        panels.forEach((p, i) => {
          if (samePanel(p, link.panel!)) at = i;
        });
        panels = at >= 0 ? panels.slice(0, at + 1) : [...panels.slice(-15), link.panel];
      }
    }
    return { view: link.view, panels, window: link.window, sectors: link.sectors };
  });
}

/**
 * Keep the hash and the store in step, and make the browser's Back button
 * walk back through screens and panels:
 * - opening a screen or panel adds a history entry;
 * - changing the window or sector lens replaces the current entry;
 * - closing a panel with the app's own Back goes back in history when the
 *   previous entry is that same place, so history doesn't fill with repeats;
 * - Back/Forward (or editing the hash) moves the app to that place.
 * Returns a function that stops syncing.
 */
export function startHashSync(win: Window = window): () => void {
  const history = win.history;
  // Our own entries in this document: stack[i] is the hash at depth i.
  const startDepth = readDepth(history.state);
  let depth = startDepth ?? 0;
  const stack: string[] = [];
  let applying = false;

  const writeState = (mode: "push" | "replace", hash: string) => {
    try {
      // Absolute, from the document's own URL: a bare "#x" would resolve against
      // the base URL, which in some frames (srcdoc) is the parent's.
      const url = `${win.location.href.split("#")[0]}${hash}`;
      const data = { ...(isObject(history.state) ? history.state : {}), wgDepth: depth };
      if (mode === "push") history.pushState(data, "", url);
      else history.replaceState(data, "", url);
    } catch {
      // Some sandboxed frames refuse history changes; fall back to the hash
      // (never to an empty one: that would reload the page).
      if (!hash) return;
      if (mode === "push") win.location.hash = hash;
      else win.location.replace(hash);
    }
  };

  const current = formatHash(linkStateOf(useNav.getState()));
  stack[depth] = current;
  if (win.location.hash !== current || startDepth === null) {
    // Tag this entry; the plain globe keeps a clean URL until the viewer moves.
    if (win.location.hash || current !== "#globe") writeState("replace", current);
    else writeState("replace", "");
  }

  const unsubscribe = useNav.subscribe((next, prev) => {
    if (applying) return;
    const before = linkStateOf(prev);
    const after = linkStateOf(next);
    const hash = formatHash(after);
    if (hash === stack[depth]) return;
    const moved = before.view !== after.view || !samePanelOrNull(before.panel, after.panel);
    if (!moved) {
      stack[depth] = hash;
      writeState("replace", hash);
      return;
    }
    // Closing panels goes back to where that place already is in history.
    if (next.panels.length < prev.panels.length) {
      const at = stack.lastIndexOf(hash, depth - 1);
      if (at >= 0 && depth > 0) {
        history.go(at - depth); // popstate brings the store along (it already matches)
        return;
      }
    }
    depth += 1;
    stack.length = depth;
    stack[depth] = hash;
    writeState("push", hash);
  });

  const onNavigate = () => {
    const known = readDepth(history.state);
    if (known === null) {
      // A hash typed or linked by hand: a new entry we didn't make.
      depth += 1;
      stack.length = depth;
      try {
        history.replaceState({ ...(isObject(history.state) ? history.state : {}), wgDepth: depth }, "");
      } catch {
        // Untagged entry; fine.
      }
    } else depth = known;
    stack[depth] = win.location.hash || "#globe";
    const link = parseHash(win.location.hash) ?? (win.location.hash ? null : parseHash("#globe"));
    if (!link) return; // e.g. "#main" from the skip link: keep the app as it is
    applying = true;
    try {
      applyLink(link);
    } finally {
      applying = false;
    }
  };

  win.addEventListener("popstate", onNavigate);
  win.addEventListener("hashchange", onNavigate);
  return () => {
    unsubscribe();
    win.removeEventListener("popstate", onNavigate);
    win.removeEventListener("hashchange", onNavigate);
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readDepth(state: unknown): number | null {
  return isObject(state) && typeof state.wgDepth === "number" ? state.wgDepth : null;
}

function samePanelOrNull(a: Panel | null, b: Panel | null): boolean {
  return a === b || (a !== null && b !== null && samePanel(a, b));
}
