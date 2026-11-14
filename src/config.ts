import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TailscaleConfig {
  /** "serve" (tailnet only) or "funnel" (public internet). Default "serve". */
  mode?: "serve" | "funnel";
  /** Tailnet-side HTTPS port. Default 443. */
  httpsPort?: number;
  /** Upstream to serve: a port, host:port, URL or unix: socket. Default: valet-ui's address. */
  target?: string;
  /** CLI command, may include args (e.g. "sudo tailscale"). Default "tailscale". */
  command?: string;
}

export interface Resolved {
  mode: "serve" | "funnel";
  httpsPort: number;
  target: string;
  command: string[];
}

const UI_DEFAULT = "http://127.0.0.1:7418";

// spec-gap: nothing in PluginContext exposes another plugin's config; the UI port is read
// back out of <valetHome>/config.toml|json the same way loadConfig does (12).
export function uiTarget(valetHome: string): string {
  const toml = join(valetHome, "config.toml");
  const path = existsSync(toml) ? toml : join(valetHome, "config.json");
  try {
    const raw = path.endsWith(".toml")
      ? Bun.TOML.parse(readFileSync(path, "utf8"))
      : JSON.parse(readFileSync(path, "utf8"));
    const cfg = (raw as { plugins?: Record<string, { config?: { host?: unknown; port?: unknown } }> })
      .plugins?.["valet-ui"]?.config;
    const host = typeof cfg?.host === "string" ? cfg.host : "127.0.0.1";
    const port = typeof cfg?.port === "number" ? cfg.port : 7418;
    return `http://${host}:${port}`;
  } catch {
    return UI_DEFAULT;
  }
}

export function normalizeTarget(target: string): string {
  if (/^\d+$/.test(target)) return `http://127.0.0.1:${target}`;
  if (target.startsWith("unix:") || target.includes("://")) return target;
  return `http://${target}`;
}

export function resolve(config: TailscaleConfig | undefined, valetHome: string): Resolved {
  const target = config?.target?.trim();
  return {
    mode: config?.mode ?? "serve",
    httpsPort: config?.httpsPort ?? 443,
    target: target ? normalizeTarget(target) : uiTarget(valetHome),
    command: (config?.command ?? "tailscale").split(/\s+/).filter(Boolean),
  };
}

export function same(a: Resolved, b: Resolved): boolean {
  return (
    a.mode === b.mode &&
    a.httpsPort === b.httpsPort &&
    a.target === b.target &&
    a.command.join(" ") === b.command.join(" ")
  );
}
