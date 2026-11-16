import type { PluginContext } from "@valethq/sdk";
import { same, type Resolved } from "./config";
import { downArgs, errorText, run, upArgs } from "./tailscale";

type Log = PluginContext["log"];

export interface Controller {
  current(): Resolved;
  /** Brings up the initial config. Throws if tailscale refuses it. */
  start(): Promise<void>;
  /** Swaps the live serve/funnel to `next`. If `next` fails, the previous one is restored and the error is thrown. */
  apply(next: Resolved): Promise<void>;
  stop(): Promise<void>;
}

export function createController(log: Log, initial: Resolved): Controller {
  let current = initial;

  const up = async (r: Resolved): Promise<void> => {
    await run(r.command, upArgs(r));
    log.info(`tailscale ${r.mode} up`, { httpsPort: r.httpsPort, target: r.target });
  };

  const down = async (r: Resolved): Promise<void> => {
    try {
      await run(r.command, downArgs(r));
      log.info(`tailscale ${r.mode} down`, { httpsPort: r.httpsPort });
    } catch (error) {
      log.warn("tailscale teardown failed", { error: errorText(error) });
    }
  };

  return {
    current: () => current,
    async start() {
      await up(current);
    },
    async apply(next) {
      if (same(next, current)) return;
      const prev = current;
      await down(prev);
      try {
        await up(next);
      } catch (error) {
        await up(prev).catch((restore: unknown) =>
          log.warn("tailscale restore failed", { error: errorText(restore) }),
        );
        throw error;
      }
      current = next;
    },
    async stop() {
      await down(current);
    },
  };
}
