# playwright-mcp

Thin TypeScript client/proxy for the official `@playwright/mcp` server.

This project does not implement browser automation itself. It starts the local `playwright-mcp` binary, connects to it as an MCP client, and exposes a small HTTP API that another AI/agent can call.

## Install

```bash
pnpm install
```

## Start Proxy

Headless:

```bash
pnpm client:server
```

Visible browser:

```bash
pnpm client:server -- --headed
```

Custom port/output directory:

```bash
pnpm client:server -- --headed --port=8931 --output-dir=reports/live
```

Open the monitor automatically:

```bash
pnpm client:server -- --headed --open
```

## API

- `GET /`
- `GET /monitor`
- `GET /monitor.html`
- `GET /health`
- `GET /tools`
- `GET /history`
- `GET /run/state`
- `GET /records`
- `GET /artifacts`
- `GET /artifact?path=<file>`
- `POST /call`
- `POST /record`
- `POST /run/start`
- `POST /run/update`
- `POST /run/finish`
- `POST /reset`

Call one MCP tool:

```json
POST /call
{
  "tool": "browser_navigate",
  "arguments": {
    "url": "https://example.com"
  }
}
```

Persist an AI-authored test record:

```json
POST /record
{
  "type": "assertion",
  "status": "pass",
  "title": "Home page loaded",
  "screenshot": "01-home.png",
  "data": {
    "expected": "Page loads",
    "actual": "Snapshot returned successfully"
  }
}
```

## Utility Commands

List Playwright MCP tools:

```bash
pnpm tools
```

Call a single tool in a short-lived session:

```bash
pnpm call -- browser_snapshot '{}'
```

Show Playwright MCP server options:

```bash
pnpm mcp:help
```

## Live Monitor

After starting the proxy, open:

```text
http://127.0.0.1:8931/
```

Use `--open` to open it automatically. `public/monitor.html` can still be opened directly if needed.

The page polls:

- `/health`
- `/run/state`
- `/history`
- `/records`
- `/artifacts`

It does not change test execution. It displays run state, records, call history, and screenshot/artifact previews.

Runtime files are written under `--output-dir`:

- `records.json`, `records.jsonl`
- `history.json`, `history.jsonl`
- `<runId>/screenshots/*`

## How It Works

```text
AI / external agent
  |
  v
HTTP proxy in src/mcp-proxy-server.ts
  |
  v
MCP client in src/mcp-client.ts
  |
  v
official @playwright/mcp server
  |
  v
Playwright browser
```

Detailed agent usage: [docs/direct-client-agent.md](docs/direct-client-agent.md)
