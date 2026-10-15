/** Test helpers for My Business and Opportunities: a fake useRpc result and a wording check. */
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

export function fakeQuery<T>(
  data: T | undefined,
  error: Error | null = null,
  refetch: () => Promise<unknown> = vi.fn(() => Promise.resolve()),
): FakeQuery<T> {
  return {
    data,
    error,
    isPending: data === undefined && !error,
    isError: !!error,
    isFetching: false,
    isPlaceholderData: false,
    refetch,
  };
}

/** Prediction markets are information only: none of these words may appear on the page. */
export const CALL_TO_ACTION = /\b(bet|bets|betting|wager|wagers|trading|odds[- ]to[- ]win|buy now|sell now)\b|^\s*trade\b/i;
