/**
 * Test helpers for this feature: a fake useRpc result, and the browser bits
 * jsdom lacks that React Flow needs (ResizeObserver, DOMMatrixReadOnly).
 */
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

/** What React Flow needs to render in jsdom (from React Flow's testing guide). */
export function installFlowMocks() {
  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 1200, height: 700 } } as ResizeObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixReadOnlyMock {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyMock);
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style.height) || 1;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style.width) || 1;
      },
    },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}
