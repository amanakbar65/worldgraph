import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRpc, rpcFailure } from "../../../server/rpc";
import { DataError } from "../source";
import { HttpSource } from "./http";

type Pool = Parameters<typeof handleRpc>[0];

/** A Postgres error as node-postgres reports one the server sent. */
const pgError = (message: string, code = "P0001") => Object.assign(new Error(message), { code, severity: "ERROR" });

const failingPool = (error: unknown) => ({ query: vi.fn(async () => Promise.reject(error)) }) as unknown as Pool;

const ctx = { viewerCountry: null, allowWrites: false };

describe("rpc failures", () => {
  it("answers 404 for an item that doesn't exist", async () => {
    const result = await handleRpc(
      failingPool(pgError("Not found: story:does-not-exist")),
      JSON.stringify({ fn: "story", args: { id: "story:does-not-exist" } }),
      ctx,
    );
    expect(result).toEqual({ status: 404, body: { error: "Not found: story:does-not-exist" } });
  });

  it("answers 400 for refused arguments and passes the reason on", () => {
    expect(rpcFailure(pgError('compare needs "ids": a list of 2 or 3 region ids'))).toEqual({
      status: 400,
      body: { error: 'compare needs "ids": a list of 2 or 3 region ids' },
    });
    expect(rpcFailure(pgError('invalid input syntax for type json', "22P02")).status).toBe(400);
  });

  it("answers 503 when the database didn't answer, and keeps its message private", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
    expect(rpcFailure(refused)).toEqual({
      status: 503,
      body: { error: "The database didn't answer. It may be waking up." },
    });
    expect(rpcFailure(new Error("Connection terminated unexpectedly")).status).toBe(503);
    expect(rpcFailure(pgError("canceling statement due to statement timeout", "57014")).status).toBe(503);
    expect(rpcFailure(pgError("sorry, too many clients already", "53300")).status).toBe(503);
  });

  it("answers 500 when the function itself failed, without its message", () => {
    expect(rpcFailure(pgError("division by zero", "22012"))).toEqual({
      status: 500,
      body: { error: "Database error." },
    });
  });
});

describe("HttpSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body === undefined ? "<html>" : JSON.stringify(body), { status })),
    );

  const failure = async () => {
    try {
      await new HttpSource().call("story", { id: "story:x" });
    } catch (error) {
      return error as DataError;
    }
    throw new Error("expected the call to fail");
  };

  it("treats a missing item as this panel's answer: not retried, says Not found", async () => {
    answer(404, { error: "Not found: story:x" });
    const error = await failure();
    expect(error).toBeInstanceOf(DataError);
    expect(error.kind).toBe("server_error");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Not found: story:x");
  });

  it("treats a function that failed as this panel's error, not retried", async () => {
    answer(500, { error: "Database error." });
    const error = await failure();
    expect([error.kind, error.retryable]).toEqual(["server_error", false]);
  });

  it("retries when the database or the host didn't answer", async () => {
    answer(503, { error: "The database didn't answer. It may be waking up." });
    expect(await failure()).toMatchObject({ kind: "unavailable", retryable: true });
    answer(502, undefined);
    expect(await failure()).toMatchObject({ kind: "unavailable", retryable: true });
    answer(500, undefined);
    expect(await failure()).toMatchObject({ kind: "unavailable", retryable: true });
  });

  it("passes a cancelled call on as an AbortError", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      }),
    );
    await expect(new HttpSource().call("meta", {}, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
