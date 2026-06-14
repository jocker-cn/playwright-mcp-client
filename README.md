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

## API

- `GET /health`
- `GET /tools`
- `GET /history`
- `GET /records`
- `GET /artifacts`
- `POST /call`
- `POST /record`
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
