/**
 * Outbound links. Only plain web links (http, https) ever become anchors;
 * anything else (javascript:, data:, relative paths) is shown as text.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed && /^https?:\/\//i.test(trimmed) ? trimmed : null;
}
