import { RESPONSES, type RpcArgs, type RpcName, type RpcResponse } from "../contract";
import { DataError, type CallOptions, type DataSource } from "../source";

/** The website: POST /api/rpc (a Netlify function, or the dev middleware). */
export class HttpSource implements DataSource {
  readonly kind = "http" as const;
  private readonly endpoint: string;

  constructor(endpoint = "/api/rpc") {
    this.endpoint = endpoint;
  }

  async call<N extends RpcName>(
    name: N,
    args: RpcArgs[N],
    options: CallOptions = {},
  ): Promise<RpcResponse<N>> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fn: name, args }),
        signal: options.signal,
        cache: options.fresh ? "no-store" : "default",
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new DataError("unavailable", "Couldn't reach WorldGraph. Check your connection.", true);
    }
    const body = (await response.json().catch(() => null)) as {
      data?: unknown;
      error?: string;
    } | null;
    if (!response.ok || !body || body.error) {
      const kind = response.status >= 500 ? "unavailable" : "server_error";
      throw new DataError(
        kind,
        body?.error ?? `The server answered ${response.status}.`,
        kind === "unavailable",
      );
    }
    const parsed = RESPONSES[name].safeParse(body.data);
    if (!parsed.success) {
      throw new DataError("bad_response", `The ${name} answer didn't match the expected shape.`);
    }
    return parsed.data as RpcResponse<N>;
  }
}
