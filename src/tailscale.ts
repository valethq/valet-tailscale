import type { Resolved } from "./config";

export const upArgs = (r: Resolved): string[] => [
  r.mode,
  "--bg",
  "--yes",
  `--https=${r.httpsPort}`,
  r.target,
];
export const downArgs = (r: Resolved): string[] => [r.mode, `--https=${r.httpsPort}`, "off"];

/** Runs the tailscale CLI; throws on a non-zero exit with stderr in the message. */
export async function run(command: string[], args: string[]): Promise<string> {
  const proc = Bun.spawn([...command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${[...command, ...args].join(" ")}: exit ${code}: ${stderr.trim() || stdout.trim()}`);
  }
  return `${stdout}${stderr}`.trim();
}
