import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTarget, resolve, uiTarget } from "../src/config";
import { downArgs, upArgs } from "../src/tailscale";

function home(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "valet-tailscale-cfg-"));
  if (config !== undefined) writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  return dir;
}

describe("uiTarget", () => {
  test("defaults to the stock valet-ui address with no config", () => {
    expect(uiTarget(home())).toBe("http://127.0.0.1:7418");
  });

  test("reads the valet-ui plugin's host and port", () => {
    const dir = home({ plugins: { "valet-ui": { config: { host: "0.0.0.0", port: 9999 } } } });
    expect(uiTarget(dir)).toBe("http://0.0.0.0:9999");
  });

  test("ignores a malformed config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "valet-tailscale-cfg-"));
    writeFileSync(join(dir, "config.json"), "{nope");
    expect(uiTarget(dir)).toBe("http://127.0.0.1:7418");
  });

  test("prefers config.toml, like core", () => {
    const dir = home({ plugins: { "valet-ui": { config: { port: 1 } } } });
    writeFileSync(join(dir, "config.toml"), "[plugins.valet-ui.config]\nport = 4321\n");
    expect(uiTarget(dir)).toBe("http://127.0.0.1:4321");
  });
});

describe("normalizeTarget", () => {
  test.each([
    ["3000", "http://127.0.0.1:3000"],
    ["localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:7418", "http://127.0.0.1:7418"],
    ["https+insecure://localhost:8443", "https+insecure://localhost:8443"],
    ["unix:/tmp/x.sock", "unix:/tmp/x.sock"],
  ])("%s -> %s", (input, out) => expect(normalizeTarget(input)).toBe(out));
});

describe("resolve + args", () => {
  test("defaults: serve the web UI on https 443", () => {
    const r = resolve(undefined, home());
    expect(r).toEqual({
      mode: "serve",
      httpsPort: 443,
      target: "http://127.0.0.1:7418",
      command: ["tailscale"],
    });
    expect(upArgs(r)).toEqual(["serve", "--bg", "--yes", "--https=443", "http://127.0.0.1:7418"]);
    expect(downArgs(r)).toEqual(["serve", "--https=443", "off"]);
  });

  test("funnel on a custom port to an explicit target", () => {
    const r = resolve(
      { mode: "funnel", httpsPort: 8443, target: "127.0.0.1:7417", command: "sudo tailscale" },
      home(),
    );
    expect(r.command).toEqual(["sudo", "tailscale"]);
    expect(upArgs(r)).toEqual(["funnel", "--bg", "--yes", "--https=8443", "http://127.0.0.1:7417"]);
    expect(downArgs(r)).toEqual(["funnel", "--https=8443", "off"]);
  });
});
