import { describe, expect, it } from "vitest";

import { SECTOR_IDS } from "@/api/contract";

import {
  addRegion,
  alignKpis,
  cleanIds,
  columnsFor,
  comparePulseRows,
  describeKpiChange,
  formatKpiChange,
  formatKpiValue,
  kpiKey,
  maxTotal,
  removeRegion,
  usesCountryFigures,
} from "./compare-data";
import { AHMEDABAD, COMPARE, GUJARAT, INDIA, USA, kpi } from "./fixtures";

describe("kpiKey", () => {
  it("strips the place so the same measure matches across countries", () => {
    expect(kpiKey({ id: "indicator:in-cpi", name: "Inflation" }, INDIA)).toBe("cpi");
    expect(kpiKey({ id: "indicator:us-cpi", name: "Inflation" }, USA)).toBe("cpi");
  });

  it("uses the most specific place first (a state's own figures)", () => {
    expect(kpiKey({ id: "indicator:in-gj-power-demand", name: "Peak power demand" }, GUJARAT)).toBe("power-demand");
    expect(kpiKey({ id: "indicator:in-power-demand", name: "Peak power demand" }, INDIA)).toBe("power-demand");
  });

  it("understands a city showing its country's figures", () => {
    expect(kpiKey({ id: "indicator:in-cpi", name: "Inflation" }, AHMEDABAD)).toBe("cpi");
  });

  it("maps another name for the same measure", () => {
    const eu = { id: "region:eu", country_id: null };
    expect(kpiKey({ id: "indicator:eu-ecb-rate", name: "ECB deposit rate" }, eu)).toBe("policy-rate");
    expect(kpiKey({ id: "indicator:eu-cpi", name: "Euro-area inflation" }, eu)).toBe("cpi");
  });

  it("falls back to the name when the id doesn't start with the place", () => {
    expect(kpiKey({ id: "indicator:brent-crude", name: "Brent crude" }, INDIA)).toBe("name:brent crude");
  });
});

describe("alignKpis", () => {
  const rows = alignKpis(COMPARE.regions);

  it("puts the same measure in the same row, shared rows first", () => {
    expect(rows.map((r) => r.key)).toEqual(["cpi", "policy-rate", "power-demand", "industrial-power", "fx", "diesel"]);
    const cpi = rows[0];
    expect(cpi.label).toBe("Inflation");
    expect(cpi.shared).toBe(2);
    expect(cpi.cells.map((c) => c?.id ?? null)).toEqual(["indicator:in-cpi", "indicator:us-cpi", null]);
  });

  it("lines up a state's own figure with its country's", () => {
    const power = rows.find((r) => r.key === "power-demand")!;
    expect(power.label).toBe("Power demand");
    expect(power.cells.map((c) => c?.id ?? null)).toEqual(["indicator:in-power-demand", null, "indicator:in-gj-power-demand"]);
  });

  it("leaves a gap where a place doesn't track the measure", () => {
    const diesel = rows.find((r) => r.key === "diesel")!;
    expect(diesel.shared).toBe(1);
    expect(diesel.cells.map((c) => c?.name ?? null)).toEqual([null, "Diesel price", null]);
  });

  it("gives a loading column empty cells", () => {
    const partial = alignKpis([COMPARE.regions[0], null]);
    expect(partial[0].cells).toHaveLength(2);
    expect(partial[0].cells[1]).toBeNull();
  });

  it("keeps one figure per place per row, and names unknown rows after the indicator", () => {
    const odd = alignKpis([
      {
        region: INDIA,
        kpis: [kpi({ id: "indicator:in-widgets", name: "Widget output" }), kpi({ id: "indicator:in-widgets", name: "Widget output (old)" })],
      },
    ]);
    expect(odd).toHaveLength(1);
    expect(odd[0].label).toBe("Widget output");
    expect(odd[0].cells[0]?.name).toBe("Widget output");
  });
});

describe("usesCountryFigures", () => {
  it("is true when a state or city shows only its country's indicators", () => {
    expect(usesCountryFigures(AHMEDABAD, [{ id: "indicator:in-cpi" }, { id: "indicator:in-fx" }])).toBe(true);
    expect(usesCountryFigures(GUJARAT, [{ id: "indicator:in-gj-power-demand" }])).toBe(false);
    expect(usesCountryFigures(INDIA, [{ id: "indicator:in-cpi" }])).toBe(false);
    expect(usesCountryFigures(AHMEDABAD, [])).toBe(false);
  });
});

describe("comparePulseRows", () => {
  it("gives nine rows with bars on a shared scale per row", () => {
    const rows = comparePulseRows(COMPARE.regions, "7d");
    expect(rows.map((r) => r.sector)).toEqual([...SECTOR_IDS]);
    const energy = rows[0];
    expect(energy.cells.map((c) => c?.count)).toEqual([7, 0, 2]);
    expect(energy.shares).toEqual([1, 0, 2 / 7]);
    const health = rows.find((r) => r.sector === "health")!;
    expect(health.shares).toEqual([0, 0, 0]);
  });

  it("leaves a loading column empty", () => {
    const rows = comparePulseRows([COMPARE.regions[0], null], "7d");
    expect(rows[0].cells[1]).toBeNull();
    expect(rows[0].shares).toEqual([1, 0]);
  });
});

describe("choosing places", () => {
  it("adds without repeats, up to three", () => {
    expect(addRegion(["region:in"], "region:us")).toEqual(["region:in", "region:us"]);
    expect(addRegion(["region:in"], "region:in")).toEqual(["region:in"]);
    expect(addRegion(["a:a", "b:b", "c:c"], "d:d")).toEqual(["a:a", "b:b", "c:c"]);
  });

  it("removes and cleans", () => {
    expect(removeRegion(["region:in", "region:us"], "region:in")).toEqual(["region:us"]);
    expect(cleanIds(["a:a", "a:a", "b:b", "c:c", "d:d"])).toEqual(["a:a", "b:b", "c:c"]);
  });

  it("orders columns by the chosen ids, with gaps while loading", () => {
    const cols = columnsFor(["region:us", "region:de", "region:in"], COMPARE);
    expect(cols.map((c) => c?.region.id ?? null)).toEqual(["region:us", null, "region:in"]);
    expect(columnsFor(["region:in"], undefined)).toEqual([null]);
  });

  it("finds the biggest story total for shared bars", () => {
    expect(maxTotal(COMPARE.regions.map((r) => r.counts))).toBe(17);
    expect(maxTotal([null])).toBe(0);
  });
});

describe("compact figures", () => {
  it("formats values and changes like the KPI tiles", () => {
    expect(formatKpiValue(3.4, "en")).toBe("3.4");
    expect(formatKpiValue(252, "en")).toBe("252");
    expect(formatKpiValue(1284.4, "en")).toBe("1,284");
    expect(formatKpiValue(1_400_000, "en")).toBe("1.4M");
    expect(formatKpiChange({ change: 0.3, unit: "%" }, "en")).toBe("▲ 0.3 pts");
    expect(formatKpiChange({ change: -0.39, unit: "INR per USD" }, "en")).toBe("▼ 0.39");
    expect(formatKpiChange({ change: 0, unit: "GW" }, "en")).toBe("• 0");
    expect(formatKpiChange({ change: null, unit: "GW" }, "en")).toBeNull();
  });

  it("says the change in words", () => {
    expect(describeKpiChange({ change: 0.3, unit: "%" }, "en")).toBe("up 0.3 points");
    expect(describeKpiChange({ change: -0.39, unit: "INR per USD" }, "en")).toBe("down 0.39 INR per USD");
    expect(describeKpiChange({ change: 0, unit: "GW" }, "en")).toBe("unchanged");
    expect(describeKpiChange({ change: null, unit: "GW" }, "en")).toBeNull();
  });
});
