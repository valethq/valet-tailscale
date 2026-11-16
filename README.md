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

Changing the config re-runs the commands live: old serve off, new one on.

## Settings panel

The plugin provides a `settings@1` panel titled "Tailscale" (valet-ui's settings page). It edits
`mode`, `httpsPort` and `target`. Saved panel values override `plugins.valet-tailscale.config` on
every boot and config reload, so a panel change survives a restart. Blank `target` means the
valet-ui default again.

Applying a change tears down the current serve or funnel and brings up the new one. If the new
one fails (for example, funnel not enabled on the tailnet), the previous one is restored, the error
is shown in the panel, and nothing is saved.

The panel shows the exposure, the target, and the `https://` URL from `tailscale status --json`.
Funnel adds a warning that the port is public.

`command` is config-only on purpose. It names the binary that runs, so the panel does not write it.
