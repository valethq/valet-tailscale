import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext, SettingsPanel } from "@valethq/sdk";
import { resolve, type Resolved, type TailscaleConfig } from "../src/config";
import type { Controller } from "../src/controller";
import { registerSettings } from "../src/settings";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "valet-tailscale-settings-"));
}

/** A status stub that prints the tailnet DNS name, as `tailscale status --json` does. */
function statusStub(): string {
  const path = join(dir(), "tailscale-status");
  writeFileSync(path, `#!/bin/sh\necho '{"Self":{"DNSName":"box.tail.ts.net."}}'\n`);
  chmodSync(path, 0o755);
  return path;
}

const SERVE_443: Resolved = {
  mode: "serve",
  httpsPort: 443,
  target: "http://127.0.0.1:7418",
  command: ["tailscale"],
};

function fakeController(current: Resolved) {
  const applied: Resolved[] = [];
  const controller: Controller = {
    current: () => current,
    start: async () => {},
    stop: async () => {},
    apply: async (next) => {
      applied.push(next);
      current = next;
    },
  };
  return { controller, applied };
}

/** Registers the panel and returns it. */
function install(opts: { config?: TailscaleConfig; controller: Controller }) {
  const panels: { key?: string; impl: SettingsPanel }[] = [];
  const ctx = {
    config: opts.config,
    paths: { valetHome: dir() },
    log: { info() {}, warn() {} },
    scopes: {
      define: () => {},
      provide: (_scope: string, impl: SettingsPanel, opts?: { key?: string }) => {
        panels.push({ key: opts?.key, impl });
        return { dispose() {} };
      },
    },
  } as unknown as PluginContext<TailscaleConfig>;
  registerSettings(ctx, opts.controller);
  return { panel: panels[0]?.impl as SettingsPanel, panels };
}

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "manifest.json"), "utf8"));
const props = manifest.configSchema.properties as Record<
  string,
  { default?: unknown; title?: string; enumNames?: string[] }
>;

describe("settings are config", () => {
  test("manifest declares titles, defaults, enumNames and x-group system", () => {
    expect(manifest.configSchema["x-group"]).toBe("system");
    expect(props.mode).toMatchObject({
      title: "Exposure",
      default: "serve",
      enumNames: ["Tailnet only (serve)", "Public internet (funnel)"],
    });
    expect(props.httpsPort).toMatchObject({ title: "HTTPS port", default: 443 });
    expect(props.target?.title).toBe("Target");
    expect(props.command).toMatchObject({ title: "CLI command", default: "tailscale" });
  });

  test("resolve falls back to the same defaults the manifest declares", () => {
    const home = dir();
    const r = resolve({}, home);
    expect(r.mode).toBe(props.mode?.default as "serve");
    expect(r.httpsPort).toBe(props.httpsPort?.default as number);
    expect(r.command).toEqual([(props.command?.default as string) ?? "tailscale"]);
  });
});

describe("settings panel", () => {
  test("a view-only panel: live status, refresh, no editable schema", () => {
    const { controller } = fakeController(SERVE_443);
    const { panel } = install({ controller });
    expect(panel.schema).toBeUndefined();
    expect(panel.get).toBeUndefined();
    expect(panel.set).toBeUndefined();
    expect(panel.refreshMs).toBe(15_000);
    expect(panel.actions?.refresh).toBeDefined();
  });

  test("tailnet serve shows the https URL on the default port", async () => {
    const { controller } = fakeController({ ...SERVE_443, command: [statusStub()] });
    const { panel } = install({ controller });
    const blocks = (await panel.view?.()) ?? [];
    expect(blocks).toContainEqual({ type: "badge", text: "Tailnet only (serve)", tone: "good" });
    expect(blocks).toContainEqual({ type: "stat", label: "URL", value: "https://box.tail.ts.net" });
    expect(blocks).toContainEqual({
      type: "group",
      layout: "row",
      blocks: [{ type: "button", label: "Refresh", action: "refresh" }],
    });
  });

  test("funnel warns about the public internet and includes the port in the URL", async () => {
    const funnel: Resolved = { ...SERVE_443, mode: "funnel", httpsPort: 8443, command: [statusStub()] };
    const { controller } = fakeController(funnel);
    const { panel } = install({ controller });
    const blocks = (await panel.view?.()) ?? [];
    expect(blocks).toContainEqual({ type: "badge", text: "Public internet (funnel)", tone: "warning" });
    expect(blocks).toContainEqual({
      type: "text",
      text: "Anyone on the internet can reach this port.",
      tone: "warning",
    });
    expect(blocks).toContainEqual({ type: "stat", label: "URL", value: "https://box.tail.ts.net:8443" });
  });

  test("a failing status call becomes a warning block, not a failed view", async () => {
    const { controller } = fakeController({ ...SERVE_443, command: ["/bin/false"] });
    const { panel } = install({ controller });
    const blocks = (await panel.view?.()) ?? [];
    const warning = blocks.find((b) => b.type === "text" && b.tone === "warning");
    expect(warning).toMatchObject({ type: "text", tone: "warning" });
    expect(JSON.stringify(warning)).toContain("Tailnet name unavailable");
  });
});
