/** Test helpers for the graph feature: a fake useRpc result and browser stubs jsdom lacks. */
import { vi } from "vitest";

export interface FakeQuery<T> {
  data: T | undefined;
  error: Error | null;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  refetch: () => Promise<unknown>;
}

export function fakeQuery<T>(data: T | undefined, error: Error | null = null): FakeQuery<T> {
  return {
    data,
    error,
    isPending: data === undefined && !error,
    isError: !!error,
    isFetching: false,
    isPlaceholderData: false,
    refetch: vi.fn(() => Promise.resolve()),
  };
}

/** A matchMedia that answers `desktop` for min-width queries and false for the rest. */
export function stubMatchMedia(desktop: () => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? desktop() : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** Give every element a size, so the canvas (mocked) is mounted. */
export function stubElementSize(width = 1200, height = 800) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}
