import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Display, PluginContext, Setting, SettingsContribution } from "@valethq/sdk";
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
  const panels: SettingsContribution[] = [];
  const ctx = {
    config: opts.config,
    paths: { valetHome: dir() },
    log: { info() {}, warn() {} },
    scopes: {
      define: () => {},
      provide: (_scope: string, impl: SettingsContribution) => {
        panels.push(impl);
        return { dispose() {} };
      },
    },
  } as unknown as PluginContext<TailscaleConfig>;
  registerSettings(ctx, opts.controller);
  const panel = panels[0] as SettingsContribution;
  const status = async () => (await panel.subsections?.())?.[0];
  const items = async (): Promise<Display[]> => ((await status())?.items ?? []) as Display[];
  return { panel, status, items };
}

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "manifest.json"), "utf8"));
const settings = manifest.settings.sections.system.subsections[0].items as Setting[];
const props = Object.fromEntries(settings.map((s) => [s.id, s]));

describe("settings are config", () => {
  test("the settings doc declares labels, defaults and option labels under system", () => {
    expect(manifest.provides).toEqual(["settings@2"]);
    expect(props.mode).toMatchObject({ label: "Exposure", input: { type: "select", default: "serve" } });
    expect(((props.mode?.input.options ?? []) as { label: string }[]).map((o) => o.label)).toEqual([
      "Tailnet only (serve)",
      "Public internet (funnel)",
    ]);
    expect(props.httpsPort).toMatchObject({ label: "HTTPS port", input: { default: 443 } });
    expect(props.target?.label).toBe("Target");
    expect(props.command).toMatchObject({ label: "CLI command", input: { default: "tailscale" } });
  });

  test("resolve falls back to the same defaults the manifest declares", () => {
    const home = dir();
    const r = resolve({}, home);
    expect(r.mode).toBe(props.mode?.input.default as "serve");
    expect(r.httpsPort).toBe(props.httpsPort?.input.default as number);
    expect(r.command).toEqual([(props.command?.input.default as string) ?? "tailscale"]);
  });
});

describe("status subsection", () => {
  test("a runtime subsection: live status and a refresh action", async () => {
    const { controller } = fakeController(SERVE_443);
    const { panel, status } = install({ controller });
    expect((await status())?.refreshMs).toBe(15_000);
    expect((await status())?.id).toBe("status");
    expect(panel.actions?.refresh).toBeDefined();
  });

  test("tailnet serve shows the https URL on the default port", async () => {
    const { controller } = fakeController({ ...SERVE_443, command: [statusStub()] });
    const { items } = install({ controller });
    const blocks = await items();
    expect(blocks).toContainEqual({ type: "badge", text: "Tailnet only (serve)", tone: "good" });
    expect(blocks).toContainEqual({ type: "stat", label: "URL", value: "https://box.tail.ts.net" });
    expect(blocks).toContainEqual({ type: "action", text: "Refresh", action: "refresh" });
  });

  test("funnel warns about the public internet and includes the port in the URL", async () => {
    const funnel: Resolved = { ...SERVE_443, mode: "funnel", httpsPort: 8443, command: [statusStub()] };
    const { controller } = fakeController(funnel);
    const { items } = install({ controller });
    const blocks = await items();
    expect(blocks).toContainEqual({ type: "badge", text: "Public internet (funnel)", tone: "warning" });
    expect(blocks).toContainEqual({
      type: "note",
      text: "Anyone on the internet can reach this port.",
      tone: "warning",
    });
    expect(blocks).toContainEqual({ type: "stat", label: "URL", value: "https://box.tail.ts.net:8443" });
  });

  test("a failing status call becomes a warning block, not a failed view", async () => {
    const { controller } = fakeController({ ...SERVE_443, command: ["/bin/false"] });
    const { items } = install({ controller });
    const blocks = await items();
    const warning = blocks.find((b) => b.type === "note" && b.tone === "warning");
    expect(warning).toMatchObject({ type: "note", tone: "warning" });
    expect(JSON.stringify(warning)).toContain("Tailnet name unavailable");
  });
});
