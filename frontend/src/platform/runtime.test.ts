import { afterEach, describe, expect, it, vi } from "vitest";

import { browserLooksIndian, viewerLooksIndian } from "./runtime";

/** Pretend the browser reports this timezone and these languages. */
function browser(timeZone: string, languages: string[]) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(((...args: ConstructorParameters<typeof real>) => {
    const format = new real(...args);
    const options = format.resolvedOptions();
    vi.spyOn(format, "resolvedOptions").mockReturnValue({ ...options, timeZone });
    return format;
  }) as unknown as typeof Intl.DateTimeFormat);
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0] ?? "");
}

describe("India's borders on 'auto'", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows the server's geo country on the website, whatever the device clock says", () => {
    browser("UTC", ["en-US"]);
    expect(viewerLooksIndian("IN")).toBe(true);
    expect(viewerLooksIndian("US")).toBe(false);
  });

  it("falls back to the browser when there is no server country (the test link)", () => {
    browser("Asia/Kolkata", ["en-US"]);
    expect(viewerLooksIndian(null)).toBe(true);
    expect(viewerLooksIndian(undefined)).toBe(true);
    // An IST clock abroad still counts, so travellers keep India's view.
    expect(viewerLooksIndian("GB")).toBe(true);
  });

  it("reads India's timezone (both names) and a language set for India", () => {
    browser("Asia/Calcutta", ["en-GB"]);
    expect(browserLooksIndian()).toBe(true);
    browser("UTC", ["en-IN"]);
    expect(browserLooksIndian()).toBe(true);
    browser("Europe/London", ["fr-FR", "hi-IN"]);
    expect(browserLooksIndian()).toBe(true);
  });

  it("stays international otherwise", () => {
    browser("Europe/Berlin", ["de-DE", "en"]);
    expect(browserLooksIndian()).toBe(false);
    expect(viewerLooksIndian(null)).toBe(false);
    // "Indonesian" (id) and the IN in other positions are not India.
    browser("Asia/Jakarta", ["id", "id-ID", "en-INTL"]);
    expect(browserLooksIndian()).toBe(false);
  });
});
