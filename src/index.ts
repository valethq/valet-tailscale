import { definePlugin, type PluginContext } from "@valethq/sdk";
import { resolve, same, type Resolved, type TailscaleConfig } from "./config";
import { downArgs, run, upArgs } from "./tailscale";

async function up(ctx: PluginContext, r: Resolved): Promise<void> {
  await run(r.command, upArgs(r));
  ctx.log.info(`tailscale ${r.mode} up`, { httpsPort: r.httpsPort, target: r.target });
}

async function tryDown(ctx: PluginContext, r: Resolved): Promise<void> {
  try {
    await run(r.command, downArgs(r));
    ctx.log.info(`tailscale ${r.mode} down`, { httpsPort: r.httpsPort });
  } catch (error) {
    ctx.log.warn("tailscale teardown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default definePlugin<TailscaleConfig>({
  async activate(ctx) {
    let current = resolve(ctx.config, ctx.paths.valetHome);
    await up(ctx, current);
    ctx.onDispose(() => tryDown(ctx, current));
    ctx.onConfigChange(async (next) => {
      const nextR = resolve(next, ctx.paths.valetHome);
      if (same(nextR, current)) return;
      await tryDown(ctx, current);
      await up(ctx, nextR);
      current = nextR;
    });
  },
});
