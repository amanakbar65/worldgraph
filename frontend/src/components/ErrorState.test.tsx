import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataError } from "@/api/source";

import { ErrorState } from "./ErrorState";

afterEach(cleanup);

describe("ErrorState", () => {
  it("says what a view without live data needs, and what works meanwhile (no 'full app' that doesn't exist)", () => {
    render(<ErrorState error={new DataError("offline", "This view needs the live database.")} onRetry={vi.fn()} />);
    expect(screen.getByText("This view needs live data")).toBeTruthy();
    const description = screen.getByText(/Supabase connector in claude\.ai/);
    expect(description.textContent).toMatch(/globe, Forecasts and Brief show sample data/);
    expect(screen.queryByText(/full app/i)).toBeNull();
    // Retrying can't help here.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a retry when the database is waking up", () => {
    const retry = vi.fn();
    render(<ErrorState error={new DataError("unavailable", "asleep", true)} onRetry={retry} />);
    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalled();
  });
});
