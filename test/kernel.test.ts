import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Boots the real kernel with a stub `tailscale` binary that records its argv.
const CLI = "/home/user/valet/valet-core/packages/core/src/cli.ts";
const ROOT = join(import.meta.dir, "..");

let home: string;
let base: string;
let tsLog: string;
let proc: Bun.Subprocess;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "valet-tailscale-"));
  tsLog = join(home, "tailscale.log");

  const stub = join(home, "tailscale-stub");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${tsLog}\nexit 0\n`);
  chmodSync(stub, 0o755);

  const out = join(home, "plugins", "valet-tailscale");
  mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...manifest, main: "./index.ts" }));
  writeFileSync(
    join(out, "index.ts"),
    `export { default } from ${JSON.stringify(join(ROOT, "src", "index.ts"))};\n`,
  );

  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port as number;
  await probe.stop(true);
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      server: { port },
      pluginPaths: [join(home, "plugins")],
      plugins: {
        "valet-ui": { config: { port: 9999 } },
        "valet-tailscale": { config: { command: stub } },
      },
    }),
  );
  proc = Bun.spawn(["bun", CLI, "start", "--home", home], {
    stdout: Bun.file(join(home, "out.log")),
    stderr: Bun.file(join(home, "err.log")),
  });
  base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 15_000;
  for (;;) {
    if ((await fetch(`${base}/`).catch(() => undefined))?.status === 200) break;
    if (Date.now() > end) throw new Error("kernel did not boot");
    await Bun.sleep(25);
  }
}, 20_000);

afterAll(async () => {
  proc?.kill("SIGTERM");
  await proc?.exited;
});

test("serves the valet-ui port from config, then tears it down on shutdown", async () => {
  const end = Date.now() + 5_000;
  for (;;) {
    if (readFileSync(tsLog, "utf8").includes("serve")) break;
    if (Date.now() > end) throw new Error("tailscale stub was never invoked");
    await Bun.sleep(25);
  }
  expect(readFileSync(tsLog, "utf8").trim()).toBe("serve --bg --yes --https=443 http://127.0.0.1:9999");

  proc.kill("SIGTERM");
  await proc.exited;
  expect(readFileSync(tsLog, "utf8").trim().split("\n")).toEqual([
    "serve --bg --yes --https=443 http://127.0.0.1:9999",
    "serve --https=443 off",
  ]);
}, 20_000);
