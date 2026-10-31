import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProvenanceResponse, type RpcName } from "@/api/contract";
import { DataError } from "@/api/source";
import { fakeQuery } from "@/features/graph/test-utils";
import { formatDate } from "@/lib/time";
import { whyPanel } from "@/state/nav";

import { EDGE_PROVENANCE, NODE_PROVENANCE, WEAK_LINK_PROVENANCE } from "./fixtures";
import WhyPanel from "./WhyPanel";

const mocks = vi.hoisted(() => ({
  meta: undefined as unknown,
  answer: undefined as unknown,
  error: null as Error | null,
  asked: [] as unknown[],
}));

vi.mock("@/api/client", () => ({
  useRpc: (name: RpcName, args: unknown, options?: { enabled?: boolean }) => {
    if (name === "meta") return fakeQuery(mocks.meta);
    if (options?.enabled === false) return fakeQuery(undefined);
    mocks.asked.push(args);
    return fakeQuery(mocks.answer, mocks.error);
  },
}));

const ON = { flags: { "kg.provenance": true } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T10:00:00Z"));
  mocks.meta = ON;
  mocks.answer = EDGE_PROVENANCE;
  mocks.error = null;
  mocks.asked = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Why is this here?", () => {
  it("uses answers in the contract's shape", () => {
    for (const answer of [EDGE_PROVENANCE, WEAK_LINK_PROVENANCE, NODE_PROVENANCE]) {
      expect(ProvenanceResponse.safeParse(answer).success).toBe(true);
    }
  });

  it("says where a link comes from: how sure, how it is known, its sources, and who added it when", () => {
    render(<WhyPanel panel={whyPanel("edge", 5326)} />);
    expect(mocks.asked).toEqual([{ target: "edge", id: 5326 }]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Why is this here? DP World operates Jebel Ali Port" }),
    ).toBeTruthy();
    expect(screen.getByText("Link")).toBeTruthy();
    expect(screen.queryByText("Sample data")).toBeNull();

    const sure = screen.getByRole("region", { name: "How sure" });
    expect(within(sure).getByRole("img", { name: "Confidence 62%" })).toBeTruthy();
    expect(within(sure).getByText("Fair confidence (62%)")).toBeTruthy();
    expect(within(sure).getByText("Reported")).toBeTruthy(); // drawn as the solid line
    expect(within(sure).getByText("A named source states it.")).toBeTruthy();
    expect(within(sure).queryByText("?")).toBeNull();

    const sources = screen.getByRole("region", { name: /^Sources/ });
    expect(within(sources).getByText("Example Business Daily")).toBeTruthy();
    expect(within(sources).getByText("Gulf port operator adds berths")).toBeTruthy();
    expect(within(sources).getByText("The operator runs the port under a long-term concession.")).toBeTruthy();
    expect(within(sources).getByText("10 d ago")).toBeTruthy();
    const link = within(sources).getByRole("link", {
      name: "Open “Gulf port operator adds berths” on Example Business Daily (new tab)",
    });
    expect(link.getAttribute("href")).toBe("https://example.com/ports/jebel-ali");
    expect(link.getAttribute("target")).toBe("_blank");

    const added = screen.getByRole("region", { name: "Added" });
    const facts = within(added).getAllByRole("definition").map((d) => d.textContent);
    expect(within(added).getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Added by",
      "From",
      "Added",
      "Last changed",
    ]);
    expect(facts[0]).toBe("News pipeline · AI analysis");
    expect(facts[1]).toContain("WorldGraph curated");
    expect(facts[2]).toBe(formatDate(EDGE_PROVENANCE.created_at));
    expect(facts[3]).toBe(formatDate(EDGE_PROVENANCE.updated_at));
    expect(facts[3]).toMatch(/28/);
  });

  it("marks a weak sample link with '?', says why, and labels it sample data without links", () => {
    mocks.answer = WEAK_LINK_PROVENANCE;
    render(<WhyPanel panel={whyPanel("link", 12)} />);
    expect(mocks.asked).toEqual([{ target: "link", id: 12 }]);
    expect(screen.getByText("Cause and effect")).toBeTruthy();
    // The sample label, and "Added by" naming the sample source.
    expect(screen.getAllByText("Sample data")).toHaveLength(2);
    const sure = screen.getByRole("region", { name: "How sure" });
    expect(within(sure).getByText("Low confidence (35%)")).toBeTruthy();
    expect(within(sure).getByText("Inferred")).toBeTruthy();
    expect(within(sure).getByText("?")).toBeTruthy();
    expect(within(sure).getByText("Nothing to cite yet: read it as a lead, not a fact.")).toBeTruthy();
    expect(screen.getByRole("region", { name: /^Sources/ }).textContent).toContain("Nothing to cite yet.");
    expect(screen.queryByRole("link")).toBeNull();
    // Added and changed at the same time: no "Last changed".
    expect(screen.queryByText("Last changed")).toBeNull();
  });

  it("says where an item comes from, with its dataset once", () => {
    mocks.answer = NODE_PROVENANCE;
    render(<WhyPanel panel={whyPanel("node", "region:in-gj")} />);
    expect(mocks.asked).toEqual([{ target: "node", id: "region:in-gj" }]);
    expect(screen.getByText("Item")).toBeTruthy();
    const sure = screen.getByRole("region", { name: "How sure" });
    expect(within(sure).getByText("No confidence given")).toBeTruthy();
    expect(within(sure).getByText("Reported")).toBeTruthy();
    expect(within(sure).queryByRole("img")).toBeNull(); // no meter, no line swatch role
    // The dataset is the one source: not repeated under Added.
    expect(within(screen.getByRole("region", { name: "Added" })).queryByText("From")).toBeNull();
    expect(screen.getByText("Natural Earth")).toBeTruthy();
  });

  it("shows a labelled loading state, then an error with a retry", () => {
    mocks.answer = undefined;
    const { unmount } = render(<WhyPanel panel={whyPanel("edge", 1)} />);
    expect(screen.getByRole("status", { name: "Loading where this comes from" })).toBeTruthy();
    unmount();

    mocks.error = new DataError("unavailable", "The database didn't answer. It may be waking up.", true);
    render(<WhyPanel panel={whyPanel("edge", 1)} />);
    const alert = screen.getByRole("alert");
    expect(() => fireEvent.click(within(alert).getByRole("button", { name: /Retry|Try again/ }))).not.toThrow();
  });

  it("says so while kg.provenance is off, without asking the api", () => {
    mocks.meta = { flags: {} };
    render(<WhyPanel panel={whyPanel("node", "org:dp-world")} />);
    expect(screen.getByText("Sources aren't shown here yet")).toBeTruthy();
    expect(mocks.asked).toEqual([]);
  });
});
