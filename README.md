# valet-tailscale

Puts a local port on the tailnet (or the public internet) with `tailscale serve --bg` or
`tailscale funnel --bg` on activate, and turns it back off on deactivate. That is the whole plugin.

With no config it serves the web UI: the `target` defaults to `valet-ui`'s `host`/`port` read out of
`<valetHome>/config.toml` (or `config.json`), falling back to `http://127.0.0.1:7418` (decision 6).

## Config

```json
{
  "plugins": {
    "valet-tailscale": {
      "config": {
        "mode": "serve",
        "httpsPort": 443,
        "target": "7418",
        "command": "sudo tailscale"
      }
    }
  }
}
```

| Field       | Meaning                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `mode`      | `"serve"` (tailnet only, default) or `"funnel"` (public internet).                                                  |
| `httpsPort` | Tailnet-side HTTPS port. Default `443`. Use e.g. `8443` for a second exposed service.                               |
| `target`    | Upstream to serve: a port (`"7417"`), `host:port`, a full URL, or `unix:/path.sock`. Default: the valet-ui address. |
| `command`   | CLI to run, may include args. Default `"tailscale"`. Use `"sudo tailscale"` when serve config needs root.           |

Settings are config (12.1): edit them via the settings UI (PATCH /settings) or `config.json`. A save
calls `onConfigChange`, which tears down the current serve or funnel and brings up the new one. If
the new one fails (for example, funnel not enabled on the tailnet), the previous one is restored and
the save is rejected.

## Settings panel

The plugin provides a view-only `settings@1` panel titled "Tailscale" above the config form. It shows
the exposure, the target, and the `https://` URL from `tailscale status --json`, with a Refresh
action and a 15s auto-refresh. Funnel adds a warning that the port is public.
