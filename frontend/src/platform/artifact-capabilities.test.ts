/**
 * The capabilities the test link is published with (scripts/artifact-capabilities.json,
 * written into dist-artifact/ARTIFACT.md by `npm run build:artifact`). The db rules
 * follow platform/types/db.d.ts.
 */
import { describe, expect, it } from "vitest";

import CAPABILITIES from "../../scripts/artifact-capabilities.json";

type Level = "view" | "interact" | "admin" | "owner";
interface Rule {
  path: string;
  read?: Level;
  write?: Level;
}

const RANK: Record<Level, number> = { view: 0, interact: 1, admin: 2, owner: 3 };
const rules = CAPABILITIES.db.rules as Rule[];

/** The levels that apply at a path: the deepest rule wins, unset levels inherit (root defaults view/interact). */
function levelsAt(path: string): { read: Level; write: Level } {
  const levels: { read: Level; write: Level } = { read: "view", write: "interact" };
  const matching = rules
    .filter((r) => {
      const prefix = r.path.replace("{self}", "me");
      return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
    })
    .sort((a, b) => a.path.length - b.path.length);
  for (const rule of matching) {
    if (rule.read) levels.read = rule.read;
    if (rule.write) levels.write = rule.write;
  }
  return levels;
}

describe("test link db rules", () => {
  it("let each viewer at Contributor or above write only their own subtree", () => {
    expect(levelsAt("data/users/me/profile")).toEqual({ read: "view", write: "interact" });
  });

  it("make everything else read-only below Editor", () => {
    for (const path of ["shared/doc", "data/stories/x", "data/users", "votes/me"]) {
      expect(levelsAt(path).write).toBe("admin");
    }
  });

  it("are valid: write never below read, both set at the root, {self} last", () => {
    expect(rules.find((r) => r.path === "")).toEqual({ path: "", read: "view", write: "admin" });
    for (const rule of rules) {
      const { read, write } = levelsAt(rule.path.replace("{self}", "me"));
      expect(RANK[write]).toBeGreaterThanOrEqual(RANK[read]);
      if (rule.path.includes("{self}")) expect(rule.path.endsWith("/{self}")).toBe(true);
      // A rule declared at the prefix of a {self} rule must set both read and write.
      const selfPrefixes = rules.filter((r) => r.path.endsWith("/{self}")).map((r) => r.path.slice(0, -7));
      if (selfPrefixes.includes(rule.path)) expect(rule.read && rule.write).toBeTruthy();
    }
  });

  it("ask for nothing else", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(["db", "mcp", "sample", "user"]);
    expect(CAPABILITIES.mcp).toEqual({ servers: [{ server: "Supabase", tools: ["execute_sql"] }] });
  });
});
