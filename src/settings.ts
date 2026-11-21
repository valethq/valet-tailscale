import type { Display, PluginContext } from "@valethq/sdk";
import type { Resolved, TailscaleConfig } from "./config";
import type { Controller } from "./controller";
import { errorText, tailnetName } from "./tailscale";

async function viewOf(r: Resolved): Promise<Display[]> {
  const funnel = r.mode === "funnel";
  const blocks: Display[] = [
    {
      type: "badge",
      text: funnel ? "Public internet (funnel)" : "Tailnet only (serve)",
      tone: funnel ? "warning" : "good",
    },
    { type: "stat", label: "Serving", value: r.target, caption: `HTTPS port ${r.httpsPort}` },
  ];
  if (funnel)
    blocks.push({ type: "note", text: "Anyone on the internet can reach this port.", tone: "warning" });
  try {
    const host = await tailnetName(r.command);
    const url = r.httpsPort === 443 ? `https://${host}` : `https://${host}:${r.httpsPort}`;
    blocks.push({ type: "stat", label: "URL", value: url });
  } catch (error) {
    blocks.push({ type: "note", text: `Tailnet name unavailable: ${errorText(error)}`, tone: "warning" });
  }
  blocks.push({ type: "action", text: "Refresh", action: "refresh" });
  return blocks;
}

/** Live status as a settings@2 runtime subsection; mode/httpsPort/target/command are config (12.1). */
export function registerSettings(ctx: PluginContext<TailscaleConfig>, controller: Controller): void {
  ctx.scopes.define({ name: "settings", version: 2, cardinality: "many" });
  ctx.scopes.provide("settings", {
    // The subsection re-reads controller + tailscale status on the next fetch.
    actions: { refresh: () => {} },
    subsections: async () => [
      {
        id: "status",
        label: "Status",
        summary: "Live status of the current serve or funnel.",
        order: -1,
        refreshMs: 15_000,
        items: await viewOf(controller.current()),
      },
    ],
  });
}
