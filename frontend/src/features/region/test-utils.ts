/** Test helper for this feature: a fake useRpc result. */
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
