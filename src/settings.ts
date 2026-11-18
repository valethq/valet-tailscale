import type { PluginContext, SettingsBlock } from "@valethq/sdk";
import type { Resolved, TailscaleConfig } from "./config";
import type { Controller } from "./controller";
import { errorText, tailnetName } from "./tailscale";

async function viewOf(r: Resolved): Promise<SettingsBlock[]> {
  const funnel = r.mode === "funnel";
  const blocks: SettingsBlock[] = [
    {
      type: "badge",
      text: funnel ? "Public internet (funnel)" : "Tailnet only (serve)",
      tone: funnel ? "warning" : "good",
    },
    { type: "stat", label: "Serving", value: r.target, caption: `HTTPS port ${r.httpsPort}` },
  ];
  if (funnel)
    blocks.push({ type: "text", text: "Anyone on the internet can reach this port.", tone: "warning" });
  try {
    const host = await tailnetName(r.command);
    const url = r.httpsPort === 443 ? `https://${host}` : `https://${host}:${r.httpsPort}`;
    blocks.push({ type: "stat", label: "URL", value: url });
  } catch (error) {
    blocks.push({ type: "text", text: `Tailnet name unavailable: ${errorText(error)}`, tone: "warning" });
  }
  blocks.push({
    type: "group",
    layout: "row",
    blocks: [{ type: "button", label: "Refresh", action: "refresh" }],
  });
  return blocks;
}

/** Live status above the config form; mode/httpsPort/target/command are config (12.1). */
export function registerSettings(ctx: PluginContext<TailscaleConfig>, controller: Controller): void {
  ctx.scopes.define({ name: "settings", version: 1, cardinality: "many" });
  ctx.scopes.provide(
    "settings",
    {
      title: "Tailscale",
      description:
        "Live status of the current serve or funnel. Edit exposure, port, and target in the form below.",
      view: () => viewOf(controller.current()),
      refreshMs: 15_000,
      actions: {
        // View re-reads controller + tailscale status on the next fetch.
        refresh: () => {},
      },
    },
    { key: "valet-tailscale" },
  );
}
