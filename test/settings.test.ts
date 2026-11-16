import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext, SettingsPanel } from "@valethq/sdk";
import type { Resolved, TailscaleConfig } from "../src/config";
import type { Controller } from "../src/controller";
import { registerSettings, validate } from "../src/settings";

type FormPanel = SettingsPanel & Required<Pick<SettingsPanel, "get" | "set">>;

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

function fakeController(current: Resolved, failWith?: string) {
  const applied: Resolved[] = [];
  const controller: Controller = {
    current: () => current,
    start: async () => {},
    stop: async () => {},
    apply: async (next) => {
      applied.push(next);
      if (failWith !== undefined) throw new Error(failWith);
      current = next;
    },
  };
  return { controller, applied };
}

/** Builds a plugin context with an in-memory kv, then registers the panel on it and returns that panel. */
function install(opts: { config?: TailscaleConfig; kv?: Record<string, unknown>; controller: Controller }) {
  const values = new Map(Object.entries(opts.kv ?? {}));
  const panels: { key?: string; impl: SettingsPanel }[] = [];
  const ctx = {
    config: opts.config,
    paths: { valetHome: dir() },
    log: { info() {}, warn() {} },
    storage: {
      kv: {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        delete: (key: string) => values.delete(key),
        list: () => [...values.keys()],
      },
    },
    scopes: {
      define: () => {},
      provide: (_scope: string, impl: SettingsPanel, opts?: { key?: string }) => {
        panels.push({ key: opts?.key, impl });
        return { dispose() {} };
      },
    },
  } as unknown as PluginContext<TailscaleConfig>;
  registerSettings(ctx, opts.controller);
  return { values, panel: panels[0]?.impl as FormPanel, panels };
}

describe("validate", () => {
  test("returns only the keys that were sent, with target trimmed", () => {
    expect(validate({ httpsPort: 8443 })).toEqual({ httpsPort: 8443 });
    expect(validate({ mode: "funnel", target: "  7417 " })).toEqual({ mode: "funnel", target: "7417" });
    expect(validate({})).toEqual({});
  });

  test.each([
    [{ mode: "tunnel" }, 'mode must be "serve" or "funnel"'],
    [{ httpsPort: 0 }, "httpsPort must be"],
    [{ httpsPort: 65536 }, "httpsPort must be"],
    [{ httpsPort: 443.5 }, "httpsPort must be"],
    [{ httpsPort: "443" }, "httpsPort must be"],
    [{ target: 7417 }, "target must be text"],
    [{ target: "127.0.0.1 7417" }, "target must not contain spaces"],
  ])("rejects %j", (values, message) => {
    expect(() => validate(values)).toThrow(message);
  });
});

describe("get", () => {
  test("panel values win over config, config fills the rest", () => {
    const { controller } = fakeController(SERVE_443);
    const { panel } = install({
      config: { mode: "funnel", httpsPort: 443, command: "sudo tailscale" },
      kv: { httpsPort: 8443 },
      controller,
    });
    expect(panel.get()).toEqual({ mode: "funnel", httpsPort: 8443, target: "" });
  });

  test("with no config reports the defaults", () => {
    const { controller } = fakeController(SERVE_443);
    const { panel } = install({ controller });
    expect(panel.get()).toEqual({ mode: "serve", httpsPort: 443, target: "" });
  });
});

describe("set", () => {
  test("applies the new config, then persists the panel keys only", async () => {
    const { controller, applied } = fakeController(SERVE_443);
    const { values, panel } = install({ config: { command: "sudo tailscale" }, controller });
    await panel.set({ mode: "funnel", httpsPort: 8443 });
    expect(applied).toEqual([
      { mode: "funnel", httpsPort: 8443, target: "http://127.0.0.1:7418", command: ["sudo", "tailscale"] },
    ]);
    expect(values.get("mode")).toBe("funnel");
    expect(values.get("httpsPort")).toBe(8443);
    expect(values.has("command")).toBe(false);
  });

  test("a failed apply persists nothing and reports the error", async () => {
    const { controller } = fakeController(SERVE_443, "funnel is not enabled");
    const { values, panel } = install({ controller });
    await expect(panel.set({ mode: "funnel" })).rejects.toThrow("funnel is not enabled");
    expect(values.size).toBe(0);
  });

  test("bad values are rejected before anything is applied", async () => {
    const { controller, applied } = fakeController(SERVE_443);
    const { panel } = install({ controller });
    await expect(panel.set({ httpsPort: 0 })).rejects.toThrow("httpsPort must be");
    expect(applied).toEqual([]);
  });

  test("a blank target keeps the valet-ui default", async () => {
    const { controller, applied } = fakeController(SERVE_443);
    const { values, panel } = install({ kv: { target: "7417" }, controller });
    await panel.set({ target: "" });
    expect(applied[0]?.target).toBe("http://127.0.0.1:7418");
    expect(values.get("target")).toBe("");
  });
});

describe("view", () => {
  test("tailnet serve shows the https URL on the default port", async () => {
    const { controller } = fakeController({ ...SERVE_443, command: [statusStub()] });
    const { panels } = install({ controller });
    const blocks = (await panels[0]?.impl.view?.()) ?? [];
    expect(blocks).toContainEqual({ type: "badge", text: "Tailnet only (serve)", tone: "good" });
    expect(blocks).toContainEqual({ type: "stat", label: "URL", value: "https://box.tail.ts.net" });
  });

  test("funnel warns about the public internet and includes the port in the URL", async () => {
    const funnel: Resolved = { ...SERVE_443, mode: "funnel", httpsPort: 8443, command: [statusStub()] };
    const { controller } = fakeController(funnel);
    const { panels } = install({ controller });
    const blocks = (await panels[0]?.impl.view?.()) ?? [];
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
    const { panels } = install({ controller });
    const blocks = (await panels[0]?.impl.view?.()) ?? [];
    expect(blocks.at(-1)).toMatchObject({ type: "text", tone: "warning" });
    expect(JSON.stringify(blocks.at(-1))).toContain("Tailnet name unavailable");
  });
});
