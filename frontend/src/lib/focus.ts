/**
 * Focus hand-back for layers that open on top of the page (the search
 * dialog, side panels and bottom sheets). A layer remembers what had focus
 * when it opened and gives focus back there when it closes, so keyboard and
 * screen-reader users never end up on <body>.
 */

/** For each open modal dialog, what had focus before it opened. */
const origins = new WeakMap<Element, HTMLElement | null>();

/**
 * The control focus should go back to later: the focused element, or, while
 * a modal dialog has focus, the element that was focused before the dialog
 * opened (an action in the search can open a panel; closing that panel then
 * goes back to where the viewer was before searching).
 */
export function focusOrigin(doc: Document = document): HTMLElement | null {
  const el = doc.activeElement;
  if (!(el instanceof HTMLElement) || el === doc.body) return null;
  const modal = el.closest("[data-modal]");
  if (modal) return origins.get(modal) ?? null;
  return el;
}

/** Record where focus is as a modal layer opens (call it before the layer takes focus). */
export function rememberOrigin(layer: Element): HTMLElement | null {
  const origin = focusOrigin(layer.ownerDocument);
  origins.set(layer, origin);
  return origin;
}

/** Nothing has focus: it is on <body>, or inside `closing`, a layer that is going away. */
export function focusIsLost(closing?: Element | null, doc: Document = document): boolean {
  const el = doc.activeElement;
  return !el || el === doc.body || (!!closing && closing.contains(el));
}

// Not checked: aria-hidden. A closing modal sheet still hides the page for a
// moment (Radix removes it as the sheet unmounts), and focus belongs there next.
function canFocus(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.isConnected && !el.closest("[inert]");
}

/**
 * Give focus back after a layer closes: to `target` when it is still on the
 * page, else to the main content. It leaves focus alone when the viewer (or
 * the layer's own action, like opening a panel) already put it somewhere.
 * Returns true when focus is on a real element afterwards.
 */
export function returnFocus(target: HTMLElement | null, closing?: Element | null, doc: Document = document): boolean {
  if (!focusIsLost(closing, doc)) return true;
  for (const candidate of [target, doc.getElementById("main")]) {
    if (!canFocus(candidate)) continue;
    candidate.focus({ preventScroll: true });
    if (doc.activeElement === candidate) return true;
  }
  return false;
}
