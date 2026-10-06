import { RESPONSES, type RpcArgs, type RpcName, type RpcResponse } from "../contract";
import { DataError, stableJson, type DataSource } from "../source";

/**
 * A snapshot of sample data published alongside the page
 * (`public/snapshot/`, made by `npm run snapshot`). It lets the Artifact show
 * a complete first frame before the connector answers, and a working sample
 * view when the connector isn't available. Only a few calls are snapshotted.
 */
export class StaticSource implements DataSource {
  readonly kind = "static" as const;
  private manifest: Promise<Record<string, string>> | null = null;

  private loadManifest(): Promise<Record<string, string>> {
    this.manifest ??= fetch("snapshot/manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
      .catch(() => ({}));
    return this.manifest;
  }

  async call<N extends RpcName>(name: N, args: RpcArgs[N]): Promise<RpcResponse<N>> {
    const manifest = await this.loadManifest();
    const file = manifest[snapshotKey(name, args)];
    if (!file) throw new DataError("offline", "This view needs the live database.");
    const data: unknown = await fetch(`snapshot/${file}`).then((r) => r.json());
    const parsed = RESPONSES[name].safeParse(data);
    if (!parsed.success) throw new DataError("bad_response", "The sample snapshot is out of date.");
    return parsed.data as RpcResponse<N>;
  }
}

export function snapshotKey(name: string, args: unknown): string {
  return `${name}:${stableJson(args ?? {})}`;
}
