/**
 * Where is this copy of the app running, and what can it use?
 *
 * - "artifact": inside claude.ai. Capabilities come from `window.claude.use()`.
 * - "web": a normal website (Netlify, or `npm run dev` locally).
 */

export const TARGET: "web" | "artifact" = __WG_TARGET__;
export const SUPABASE_PROJECT_ID = __WG_SUPABASE_PROJECT__;
export const SUPABASE_CONNECTOR = __WG_CONNECTOR__;

type CapabilityName = keyof ClaudeCapabilityMap & string;

function runtime(): Claude | null {
  const candidate = (globalThis as { claude?: Claude }).claude;
  return candidate && typeof candidate.use === "function" ? candidate : null;
}

/** True when a claude.ai viewer is hosting this page. */
export function inClaude(): boolean {
  return runtime() !== null;
}

const cache = new Map<string, Promise<unknown>>();

/**
 * Resolve a capability once; `null` means "not available in this view"
 * (not served, not granted, or not inside claude.ai). Never throws.
 */
export function capability<K extends CapabilityName>(name: K): Promise<ClaudeCapabilityMap[K] | null> {
  const existing = cache.get(name);
  if (existing) return existing as Promise<ClaudeCapabilityMap[K] | null>;
  const claude = runtime();
  const promise: Promise<ClaudeCapabilityMap[K] | null> = claude
    ? claude.use(name).catch(() => null)
    : Promise.resolve(null);
  cache.set(name, promise);
  return promise;
}

/**
 * Guess whether the viewer is in India, for India's official map borders.
 * The website gets the country from Netlify's geo header via api.meta;
 * inside claude.ai we only have the browser's timezone.
 */
export function browserLooksIndian(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz === "Asia/Kolkata" || tz === "Asia/Calcutta";
  } catch {
    return false;
  }
}
