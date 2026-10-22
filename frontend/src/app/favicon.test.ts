import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("favicon", () => {
  it("is linked from the page (Vite makes the path relative for the test link)", () => {
    expect(read("../../index.html")).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });

  it("is a valid SVG globe in the brand's slate and teal", () => {
    const svg = read("../../public/favicon.svg");
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull(); // e.g. "--" inside a comment breaks it
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(doc.querySelector("title")?.textContent).toBe("WorldGraph");
    expect(doc.querySelector("circle")).not.toBeNull();
    // Only the dark theme's tokens: bg tile, neutral slate, opportunity teal.
    expect(new Set(svg.match(/#[0-9a-f]{6}\b/gi))).toEqual(new Set(["#0d1017", "#8e96a0", "#4aded0"]));
  });
});
