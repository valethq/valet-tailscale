import type { PluginContext, SettingsBlock } from "@valethq/sdk";
import { effective, PANEL_KEYS, resolve, type Resolved, type TailscaleConfig } from "./config";
import type { Controller } from "./controller";
import { errorText, tailnetName } from "./tailscale";

type Panel = Pick<TailscaleConfig, "mode" | "httpsPort" | "target">;

/** Checks the form values and returns only the keys that were sent. Throws on the first bad value. */
export function validate(values: Record<string, unknown>): Panel {
  const { mode, httpsPort, target } = values;
  const out: Panel = {};
  if (mode !== undefined) {
    if (mode !== "serve" && mode !== "funnel") throw new Error('mode must be "serve" or "funnel"');
    out.mode = mode;
  }
  if (httpsPort !== undefined) {
    if (typeof httpsPort !== "number" || !Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) {
      throw new Error("httpsPort must be a whole number from 1 to 65535");
    }
    out.httpsPort = httpsPort;
  }
  if (target !== undefined) {
    if (typeof target !== "string") throw new Error("target must be text");
    const trimmed = target.trim();
    if (/\s/.test(trimmed)) throw new Error("target must not contain spaces");
    out.target = trimmed;
  }
  return out;
}

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
  return blocks;
}

export function registerSettings(ctx: PluginContext<TailscaleConfig>, controller: Controller): void {
  const home = ctx.paths.valetHome;
  ctx.scopes.define({ name: "settings", version: 1, cardinality: "many" });
  ctx.scopes.provide(
    "settings",
    {
      title: "Tailscale",
      description:
        "Overrides plugins.valet-tailscale.config. Applies at once: the current serve or funnel is replaced, or kept if the new one fails.",
      view: () => viewOf(controller.current()),
      schema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            title: "Exposure",
            enum: ["serve", "funnel"],
            enumNames: ["Tailnet only (serve)", "Public internet (funnel)"],
            description:
              "Funnel puts the port on the public internet. Tailscale refuses ports it does not allow for funnel.",
          },
          httpsPort: {
            type: "integer",
            title: "HTTPS port",
            minimum: 1,
            maximum: 65535,
            description: "Port on the tailnet (or public) side. 443 unless you serve a second service.",
          },
          target: {
            type: "string",
            title: "Target",
            description: "Port, host:port, URL or unix:/path.sock. Blank serves the valet-ui address.",
          },
        },
      },
      get: () => {
        const eff = effective(ctx, ctx.config);
        const r = resolve(eff, home);
        return { mode: r.mode, httpsPort: r.httpsPort, target: eff.target?.trim() ?? "" };
      },
      set: async (values) => {
        const patch = validate(values);
        await controller.apply(resolve({ ...effective(ctx, ctx.config), ...patch }, home));
        for (const key of PANEL_KEYS) {
          const value = patch[key];
          if (value !== undefined) ctx.storage.kv.set(key, value);
        }
      },
    },
    { key: "valet-tailscale" },
  );
}
