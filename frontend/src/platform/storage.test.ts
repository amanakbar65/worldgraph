import { describe, expect, it } from "vitest";

import { __testing, getUserStore } from "./storage";

describe("user storage", () => {
  it("falls back to this browser outside claude.ai", async () => {
    __testing.reset();
    const store = await getUserStore();
    expect(store.kind).toBe("browser");
    await store.set("profile", { sectors: ["energy"] });
    expect(await store.get("profile")).toEqual({ sectors: ["energy"] });
    await store.remove("profile");
    expect(await store.get("profile")).toBeNull();
  });

  it("keeps values in memory when storage is blocked", async () => {
    const store = __testing.memoryStore();
    await store.set("watchlist", ["region:in"]);
    expect(await store.get("watchlist")).toEqual(["region:in"]);
  });

  it("rejects keys that aren't short slugs", async () => {
    const store = __testing.memoryStore();
    await expect(store.set("../x", 1)).rejects.toThrow(TypeError);
  });
});
