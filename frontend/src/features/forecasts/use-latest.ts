import { useState } from "react";

/**
 * The latest defined value: while a new answer loads (after a filter
 * change), the previous one stays on screen instead of a blank list.
 */
export function useLatest<T>(value: T | undefined): { value: T | undefined; stale: boolean } {
  const [last, setLast] = useState<T | undefined>(value);
  if (value !== undefined && value !== last) setLast(value);
  return value !== undefined ? { value, stale: false } : { value: last, stale: last !== undefined };
}
