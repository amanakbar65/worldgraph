import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MetaList } from "./forecast-parts";

afterEach(cleanup);

function Nothing() {
  return null;
}

describe("MetaList", () => {
  it("separates facts with the app's '·' (as StoryCard and ForecastRow do), not a drawn dot", () => {
    render(
      <MetaList>
        <span>Sample forecast</span>
        <span>Updated 4 min ago</span>
      </MetaList>,
    );
    const item = screen.getByText("Updated 4 min ago").parentElement!;
    expect(item.className).toContain("before:content-['·'_/_'']");
    expect(item.className).not.toContain("before:rounded-full");
  });

  it("hides an item whose content renders nothing, so no separator dangles", () => {
    const { container } = render(
      <MetaList>
        <span>Sample forecast</span>
        <Nothing />
      </MetaList>,
    );
    const items = container.querySelectorAll("span.empty\\:hidden");
    expect(items).toHaveLength(2);
    // Empty in the DOM (the separator is generated), so :empty hides it.
    expect(items[1].childNodes).toHaveLength(0);
  });
});
