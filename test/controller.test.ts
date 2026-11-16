import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "@valethq/sdk";
import { resolve } from "../src/config";
import { createController } from "../src/controller";

// Records each call; fails any `serve --bg ... --https=8443` so the rollback path runs.
let dir: string;
let log: string;
let stub: string;
const logger = { info() {}, warn() {} } as unknown as PluginContext["log"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "valet-tailscale-ctl-"));
  log = join(dir, "calls.log");
  stub = join(dir, "tailscale");
  writeFileSync(
    stub,
    `#!/bin/sh\necho "$*" >> ${log}\ncase "$*" in *"--bg"*"--https=8443"*) echo boom >&2; exit 1;; esac\nexit 0\n`,
  );
  chmodSync(stub, 0o755);
});

afterEach(() => {});

const calls = () => readFileSync(log, "utf8").trim().split("\n");

test("a failed apply restores the previous serve and keeps it as current", async () => {
  const home = mkdtempSync(join(tmpdir(), "valet-tailscale-home-"));
  const at443 = resolve({ target: "9999", command: stub }, home);
  const at8443 = resolve({ target: "9999", command: stub, httpsPort: 8443 }, home);
  const ctl = createController(logger, at443);

  await ctl.start();
  await expect(ctl.apply(at8443)).rejects.toThrow("boom");
  expect(ctl.current()).toEqual(at443);

  await ctl.stop();
  expect(calls()).toEqual([
    "serve --bg --yes --https=443 http://127.0.0.1:9999",
    "serve --https=443 off",
    "serve --bg --yes --https=8443 http://127.0.0.1:9999",
    "serve --bg --yes --https=443 http://127.0.0.1:9999",
    "serve --https=443 off",
  ]);
});

test("a successful apply tears down the old config and brings up the new one", async () => {
  const home = mkdtempSync(join(tmpdir(), "valet-tailscale-home-"));
  const at443 = resolve({ target: "9999", command: stub }, home);
  const at444 = resolve({ target: "9999", command: stub, httpsPort: 444 }, home);
  const ctl = createController(logger, at443);

  await ctl.start();
  await ctl.apply(at444);
  expect(ctl.current()).toEqual(at444);
  await ctl.apply(at444);
  expect(calls()).toEqual([
    "serve --bg --yes --https=443 http://127.0.0.1:9999",
    "serve --https=443 off",
    "serve --bg --yes --https=444 http://127.0.0.1:9999",
  ]);
});
