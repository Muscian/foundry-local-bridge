# Foundry Local Bridge

Foundry Local Bridge is a small Foundry VTT companion module for local AI and automation tools.

It connects your **GM browser session** to a local WebSocket server running on your own machine. The intended companion server is [`foundry-local-mcp`](https://github.com/Muscian/foundry-local-mcp), but the protocol is simple JSON-over-WebSocket and can be used by other local tools as well.

This module is useful when your Foundry world is hosted remotely, but you still open it locally in a browser as GM. The module runs inside that browser session and can safely execute narrow Foundry operations that remote MCP services or generic bridge modules may not expose.

## Do I Need This and Foundry API Bridge?

For the full [`foundry-local-mcp`](https://github.com/Muscian/foundry-local-mcp) setup, yes, you normally use two Foundry modules:

- **A Foundry API Bridge-compatible module** connected to `ws://127.0.0.1:3001/ws` for general automation: actors, items, scenes, tokens, combat, journals, dice, and other broad world operations.
- **Foundry Local Bridge** connected to `ws://127.0.0.1:3003/ws` for token/prototype-token operations that generic bridge modules may not expose: token texture, token dimensions, and actor prototype token setup.

This module is intentionally a companion, not a complete replacement for a broad Foundry API bridge.

## What It Does

The module currently exposes these commands to a local WebSocket server:

- `companion-status`
- `set-actor-prototype-token`
- `update-token-from-actor`
- `create-token-from-actor`

These commands are intentionally narrow. They focus on token/prototype-token operations that are often needed by automation tools and are not always available through generic Foundry API bridge modules.

## Architecture

```text
AI client / local tool
-> local bridge server on your machine
-> ws://127.0.0.1:3003/ws
-> Foundry Local Bridge module in your GM browser tab
-> Foundry VTT world
```

## Installation via Manifest URL

Install it in Foundry using this manifest URL:

```text
https://raw.githubusercontent.com/Muscian/foundry-local-bridge/main/module.json
```

Then:

1. Enable `Foundry Local Bridge` in your world.
2. Open the world as GM from the same machine where your local bridge server is running.
3. Configure the module setting:

```text
ws://127.0.0.1:3003/ws
```

4. Reload the world.

## Updating on FoundryServer

Once installed by manifest URL, updating is the normal Foundry module flow:

1. Push a new version to GitHub.
2. Update `version` in `module.json`.
3. Publish a matching GitHub release zip named `foundry-local-bridge.zip`.
4. In FoundryServer, use the module update flow.

## Local Development

You can install this module manually by copying this repository folder into:

```text
FoundryVTT/Data/modules/foundry-local-bridge
```

For hosted FoundryServer installs, use the manifest URL or upload a zip whose root contains `module.json`.

## Command Protocol

The local server sends commands:

```json
{
  "id": "unique-command-id",
  "type": "set-actor-prototype-token",
  "params": {
    "actorId": "abc123",
    "width": 2,
    "height": 2
  }
}
```

The module replies:

```json
{
  "id": "unique-command-id",
  "success": true,
  "data": {}
}
```

Errors use:

```json
{
  "id": "unique-command-id",
  "success": false,
  "error": "Error message"
}
```

## Security Notes

- The module only connects when the current Foundry user is a GM.
- It should point to `127.0.0.1` unless you fully understand the security implications.
- Do not expose the local WebSocket server to the public internet.
- Commands are intentionally limited to token and prototype-token operations.

## License

MIT
