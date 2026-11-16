import type { Resolved } from "./config";

export const upArgs = (r: Resolved): string[] => [
  r.mode,
  "--bg",
  "--yes",
  `--https=${r.httpsPort}`,
  r.target,
];
export const downArgs = (r: Resolved): string[] => [r.mode, `--https=${r.httpsPort}`, "off"];

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function spawn(command: string[], args: string[]) {
  const proc = Bun.spawn([...command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** Runs the tailscale CLI; throws on a non-zero exit with stderr in the message. */
export async function run(command: string[], args: string[]): Promise<string> {
  const { stdout, stderr, code } = await spawn(command, args);
  if (code !== 0) {
    throw new Error(`${[...command, ...args].join(" ")}: exit ${code}: ${stderr.trim() || stdout.trim()}`);
  }
  return `${stdout}${stderr}`.trim();
}

/** This node's MagicDNS name (e.g. "host.tailnet.ts.net") from `tailscale status --json`. */
export async function tailnetName(command: string[]): Promise<string> {
  const { stdout, stderr, code } = await spawn(command, ["status", "--json"]);
  if (code !== 0) throw new Error(`status: exit ${code}: ${stderr.trim()}`);
  const dns = (JSON.parse(stdout) as { Self?: { DNSName?: unknown } }).Self?.DNSName;
  if (typeof dns !== "string" || dns === "") throw new Error("no DNSName in tailscale status");
  return dns.replace(/\.$/, "");
}
