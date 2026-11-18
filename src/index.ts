import { definePlugin, type PluginContext } from "@valethq/sdk";
import { resolve, type TailscaleConfig } from "./config";
import { createController } from "./controller";
import { registerSettings } from "./settings";

export default definePlugin<TailscaleConfig>({
  async activate(ctx: PluginContext<TailscaleConfig>) {
    const home = ctx.paths.valetHome;
    const controller = createController(ctx.log, resolve(ctx.config, home));
    await controller.start();
    ctx.onDispose(() => controller.stop());
    ctx.onConfigChange((next) => controller.apply(resolve(next, home)));
    registerSettings(ctx, controller);
  },
});
