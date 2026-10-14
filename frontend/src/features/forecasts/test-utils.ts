/** Test helpers for this feature: a fake useRpc result and a check for call-to-action wording. */
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

/**
 * Prediction markets are information only: no control may invite anyone to
 * bet, trade, buy or sell, and the page never uses those words for itself.
 */
export const CALL_TO_ACTION = /\b(bet|bets|betting|wager|wagers|trading|odds[- ]to[- ]win|buy|sell)\b|^\s*trade\b/i;
