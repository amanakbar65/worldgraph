// @vitest-environment node
/**
 * The website's server side (server/rpc.ts and server/db.ts, used by the
 * Netlify functions and the dev middleware).
 */
import { describe, expect, it, vi } from "vitest";

import { SUPABASE_ROOT_CA, websitePoolConfig } from "../../server/db";
import { bodyTooLarge, handleRpc, MAX_BODY_BYTES } from "../../server/rpc";

type Pool = Parameters<typeof handleRpc>[0];

/** A pool that answers every query with `data` and records what it ran. */
function answeringPool(data: unknown) {
  const query = vi.fn(async (_text: string, _params?: unknown[]) => ({ rows: [{ data }] }));
  return { pool: { query } as unknown as Pool, query };
}

const publicVisitor = { viewerCountry: "IN", allowWrites: false };
const owner = { viewerCountry: null, allowWrites: true };
const call = (fn: string, args: unknown = {}) => JSON.stringify({ fn, args });

describe("handleRpc", () => {
  it("refuses pending_analysis (raw drafts) to public visitors, like writes", async () => {
    const { pool, query } = answeringPool({ items: [] });
    expect(await handleRpc(pool, call("pending_analysis", { limit: 30 }), publicVisitor)).toEqual({
      status: 403,
      body: { error: "Not allowed." },
    });
    expect(await handleRpc(pool, call("save_analysis", { items: [] }), publicVisitor)).toMatchObject({
      status: 403,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("still serves pending_analysis to the owner's own tools", async () => {
    const { pool, query } = answeringPool({ items: [] });
    expect(await handleRpc(pool, call("pending_analysis", { limit: 30 }), owner)).toEqual({
      status: 200,
      body: { data: { items: [] } },
    });
    expect(query.mock.calls[0][0]).toBe("select api.pending_analysis($1::jsonb) as data");
  });

  it("limits the body in UTF-8 bytes, not characters", async () => {
    const { pool, query } = answeringPool({});
    // 30,000 CJK characters are 90,000 bytes: over the 64 KiB limit.
    const cjk = call("search", { q: "漢".repeat(30_000) });
    expect(cjk.length).toBeLessThan(MAX_BODY_BYTES);
    expect(await handleRpc(pool, cjk, publicVisitor)).toEqual({
      status: 413,
      body: { error: "Request too large." },
    });
    // The same number of ASCII characters is under it.
    const ascii = call("search", { q: "a".repeat(30_000) });
    expect((await handleRpc(pool, ascii, publicVisitor)).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("adds the server-decided viewer country to meta, whatever the browser sends", async () => {
    const meta = { generated_at: "2026-10-22T00:00:00Z", data: {}, sectors: [], sources: [] };
    const { pool, query } = answeringPool(meta);
    const sent = call("meta", { _viewer: { country: "US" }, viewer_country: "US" });
    expect(await handleRpc(pool, sent, publicVisitor)).toEqual({
      status: 200,
      body: { data: { ...meta, viewer_country: "IN" } },
    });
    expect(JSON.parse(query.mock.calls[0][1]![0] as string)._viewer).toEqual({ country: "IN" });
    const unknown = await handleRpc(answeringPool(meta).pool, call("meta"), owner);
    expect((unknown.body.data as { viewer_country: unknown }).viewer_country).toBeNull();
  });

  it("leaves other answers as the database gave them", async () => {
    const { pool } = answeringPool({ events: [] });
    expect(await handleRpc(pool, call("globe", { window: "24h" }), publicVisitor)).toEqual({
      status: 200,
      body: { data: { events: [] } },
    });
  });
});

describe("bodyTooLarge", () => {
  it("refuses a declared size over the limit before the body is read", () => {
    expect(bodyTooLarge(new Headers({ "content-length": String(MAX_BODY_BYTES + 1) }))).toBe(true);
    expect(bodyTooLarge(new Headers({ "content-length": String(MAX_BODY_BYTES) }))).toBe(false);
    expect(bodyTooLarge(new Headers())).toBe(false);
  });
});

describe("websitePoolConfig", () => {
  const supabase = "postgresql://wg_web.ref:secret@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";

  it("always verifies TLS, against Supabase's root CA by default", () => {
    const config = websitePoolConfig({ DATABASE_URL: supabase }, 2);
    expect(config).toMatchObject({ connectionString: supabase, max: 2 });
    expect(config?.ssl).toEqual({ ca: SUPABASE_ROOT_CA, rejectUnauthorized: true });
  });

  it("uses DATABASE_CA_CERT instead when it is set", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nother\n-----END CERTIFICATE-----";
    const config = websitePoolConfig({ DATABASE_URL: supabase, DATABASE_CA_CERT: `${ca}\n` }, 1);
    expect(config?.ssl).toEqual({ ca, rejectUnauthorized: true });
    expect(websitePoolConfig({ DATABASE_URL: supabase, DATABASE_CA_CERT: " " }, 1)?.ssl).toEqual({
      ca: SUPABASE_ROOT_CA,
      rejectUnauthorized: true,
    });
  });

  it("drops TLS settings from the URL, which node-postgres would let win", () => {
    for (const query of [
      "sslmode=require",
      "sslmode=disable",
      "sslmode=no-verify",
      "ssl=0",
      "sslrootcert=/x.crt",
    ]) {
      const config = websitePoolConfig({ DATABASE_URL: `${supabase}?${query}&application_name=wg` }, 1);
      expect(config?.connectionString).toBe(`${supabase}?application_name=wg`);
      expect(config?.ssl).toEqual({ ca: SUPABASE_ROOT_CA, rejectUnauthorized: true });
    }
  });

  it("answers null (the function says 503) without a usable DATABASE_URL", () => {
    expect(websitePoolConfig({}, 1)).toBeNull();
    expect(websitePoolConfig({ DATABASE_URL: "  " }, 1)).toBeNull();
    expect(websitePoolConfig({ DATABASE_URL: "not a url" }, 1)).toBeNull();
    expect(websitePoolConfig({ DATABASE_URL: "https://example.com/db" }, 1)).toBeNull();
  });

  it("skips TLS only for a database on this machine (netlify dev)", () => {
    expect(websitePoolConfig({ DATABASE_URL: "postgresql://wg:wg@localhost:5432/wg" }, 1)?.ssl).toBe(false);
    expect(websitePoolConfig({ DATABASE_URL: "postgres://wg:wg@127.0.0.1/wg" }, 1)?.ssl).toBe(false);
    expect(
      websitePoolConfig({ DATABASE_URL: "postgresql://wg:wg@localhost.example.com/wg" }, 1)?.ssl,
    ).toMatchObject({
      rejectUnauthorized: true,
    });
  });

  it("bundles the official Supabase Root 2021 CA (prod-ca-2021.crt)", async () => {
    const base64 = SUPABASE_ROOT_CA.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "");
    const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
    const fingerprint = Array.from(digest, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    expect(fingerprint).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
  });
});
