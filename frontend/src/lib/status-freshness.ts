/**
 * "Updated 4 min ago" for the status bar, from the newest live data time.
 * Short form ("4 min ago") for narrow screens. Null when there's no time
 * or it can't be read.
 */
export function freshnessText(iso: string | null | undefined, now: number): { long: string; short: string } | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  let ago: string;
  if (minutes < 1) ago = "just now";
  else if (minutes < 60) ago = `${minutes} min ago`;
  else if (minutes < 60 * 24) ago = `${Math.floor(minutes / 60)} h ago`;
  else {
    const days = Math.floor(minutes / (60 * 24));
    ago = `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return { long: `Updated ${ago}`, short: ago === "just now" ? "Just now" : ago };
}
