# Customization: Sandboxed Extensions

Extensions live under `<config>/extensions/<id>/` and require:

- `manifest.json`
- `main.js`

Example manifest:

```json
{
  "id": "local.example.panel",
  "name": "Example Panel",
  "version": "1.0.0",
  "main": "main.js",
  "capabilities": ["ui.panel", "host.info", "log.write"]
}
```

Enabled extensions run in sandboxed iframes with no Node, Electron, filesystem, network, forms, or child frame access. Remote code is blocked by CSP; extension code must be local.

The injected `window.hcbExtension` API exposes:

- `hostInfo()`
- `log(message, level)`

Create a `safe-mode` file in the config directory to disable all extension and snippet loading.
