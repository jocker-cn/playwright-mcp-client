# Direct MCP Client Agent Guide

Thin HTTP proxy for AI-led UI testing with `@playwright/mcp`.

```text
AI -> HTTP proxy -> MCP client -> @playwright/mcp -> Playwright browser
```

The proxy starts `@playwright/mcp`; the AI only calls HTTP APIs.

## Start

```bash
pnpm client:server
pnpm client:server -- --headed
pnpm client:server -- --headed --open
pnpm client:server -- --headed --port=8931 --viewport-size=1440x900 --output-dir=reports/live
```

Options:

- `--headed`: visible browser
- `--open`: open the monitor page automatically
- `--port=<number>`: default `8931`
- `--viewport-size=<width>x<height>`: default `1440x900`
- `--output-dir=<path>`: MCP files, `records.json`, `records.jsonl`, `history.json`, `history.jsonl`, run artifacts

## Live Monitor

Open `http://127.0.0.1:8931/` after the proxy starts. If a custom port is used, open that port instead.

`public/monitor.html` can also be opened directly, but the proxy-served URL is the default path.

The monitor is static HTML. It polls the proxy APIs and displays:

- current run status and plan
- latest and full `/record` entries
- latest and full `/call` history
- files and screenshots under `outputDir`

It does not execute tests or mutate state.

## Agent Loop

1. `GET /health`
2. `GET /tools`
3. `POST /run/start` with a resumable test plan
4. `GET /run/state` before each next action
5. `POST /call` for browser actions and observations
6. `POST /record` for observations, assertions, findings, blockers
7. `POST /run/update` after each plan step
8. Generate report from `/run/state`, `/history`, `/records`, `/artifacts`

When writing records for a plan step, include `data.stepId`. When updating a step, include evidence links:

```json
{
  "stepId": "login",
  "stepStatus": "completed",
  "summary": "Login succeeded",
  "evidence": {
    "records": [2, 3],
    "history": [5, 6, 7],
    "screenshots": ["login/01-page.png", "login/02-success.png"]
  }
}
```

The monitor uses these links when a user clicks a plan step.

## API Summary

| API | Purpose |
|---|---|
| `GET /` | monitor page |
| `GET /monitor` | monitor page |
| `GET /monitor.html` | monitor page |
| `GET /health` | proxy status |
| `GET /tools` | MCP tool schemas |
| `POST /call` | call one MCP tool |
| `GET /history` | raw `/call` history |
| `POST /record` | write AI-authored result |
| `GET /records` | read AI-authored results |
| `POST /run/start` | create resumable run plan |
| `GET /run/state` | read current run progress |
| `POST /run/update` | update run or step progress |
| `POST /run/finish` | mark run complete/failed/blocked |
| `GET /artifacts` | list files in `outputDir` |
| `POST /reset` | restart browser/MCP session |

## `GET /health`

Checks proxy readiness.

```json
{
  "ok": true,
  "port": 8931,
  "outputDir": "reports/mcp-proxy",
  "headed": false,
  "historyCount": 0,
  "recordCount": 0,
  "runStatus": "idle"
}
```

## `GET /tools`

Returns current `@playwright/mcp` tool schemas.

```json
{
  "ok": true,
  "result": {
    "tools": [
      {
        "name": "browser_navigate",
        "description": "Navigate to a URL",
        "inputSchema": {}
      }
    ]
  }
}
```

Common tools:

- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_fill_form`
- `browser_wait_for`
- `browser_take_screenshot`
- `browser_console_messages`
- `browser_network_requests`
- `browser_network_request`
- `browser_tabs`

## `POST /call`

Calls one MCP tool. Every call is appended to `/history` and saved to:

- `<outputDir>/history.jsonl`
- `<outputDir>/history.json`

When calling `browser_take_screenshot`, the proxy does not rewrite `filename`. The AI must provide a task-scoped path under `outputDir`, for example:

```text
reports/live/<runId>/screenshots/login/01-page.png
```

Use the exact same path in `/record.screenshot` and `/run/update.evidence.screenshots`. The monitor only displays screenshots whose recorded path matches an artifact path returned by `/artifacts`.

Request:

```json
{
  "tool": "browser_navigate",
  "arguments": {
    "url": "https://example.com"
  }
}
```

Response:

```json
{
  "ok": true,
  "index": 1,
  "startedAt": "2026-06-14T09:00:00.000Z",
  "tool": "browser_navigate",
  "arguments": {
    "url": "https://example.com"
  },
  "result": {
    "content": [
      {
        "type": "text",
        "text": "..."
      }
    ]
  }
}
```

Examples:

```json
{ "tool": "browser_snapshot", "arguments": {} }
```

```json
{
  "tool": "browser_click",
  "arguments": {
    "element": "登录按钮",
    "target": "e76"
  }
}
```

```json
{
  "tool": "browser_take_screenshot",
  "arguments": {
    "filename": "reports/live/run-001/screenshots/login/01-login-page.png",
    "fullPage": true
  }
}
```

## `GET /history`

Returns raw MCP call history. The same data is persisted in `<outputDir>/history.json`.

```json
{
  "ok": true,
  "history": [
    {
      "index": 1,
      "startedAt": "2026-06-14T09:00:00.000Z",
      "tool": "browser_snapshot",
      "arguments": {},
      "result": {}
    }
  ]
}
```

Use it as evidence, not as the final report.

## Run State APIs

Run state keeps the test resumable when AI context is lost.

### `POST /run/start`

Creates a run plan and writes `<outputDir>/run-state.json`.

```json
{
  "target": "http://localhost:8080",
  "goal": "Complete UI smoke test",
  "plan": [
    { "id": "load", "title": "Open site" },
    { "id": "login", "title": "Login" },
    { "id": "home", "title": "Check home page" },
    { "id": "report", "title": "Generate report" }
  ]
}
```

Response:

```json
{
  "ok": true,
  "run": {
    "id": "run-2026-06-14T09-00-00-000Z",
    "status": "running",
    "plan": [
      { "id": "load", "title": "Open site", "status": "pending" }
    ]
  },
  "file": "reports/mcp-proxy/run-state.json"
}
```

### `GET /run/state`

Returns current run progress.

```json
{
  "ok": true,
  "outputDir": "reports/mcp-proxy",
  "run": {
    "status": "running",
    "plan": []
  }
}
```

### `POST /run/update`

Updates the whole run or one step.

```json
{
  "stepId": "login",
  "stepStatus": "completed",
  "summary": "Login succeeded and redirected to home",
  "evidence": {
    "history": [3, 4, 5],
    "records": [2],
    "screenshots": ["02-home.png"]
  }
}
```

Step statuses:

- `pending`
- `in_progress`
- `completed`
- `failed`
- `blocked`
- `skipped`

Run statuses:

- `idle`
- `running`
- `completed`
- `failed`
- `blocked`

### `POST /run/finish`

Marks the run finished.

```json
{
  "status": "completed",
  "summary": "Smoke test completed without blocking issues"
}
```

## `POST /record`

Writes one AI-authored test result. Records are saved to:

- `<outputDir>/records.jsonl`
- `<outputDir>/records.json`

Request:

```json
{
  "type": "assertion",
  "status": "pass",
  "title": "Login page loaded",
  "url": "http://localhost:8080/#/login",
  "screenshot": "01-login-page.png",
  "snapshotRef": "history:3",
  "severity": "P2",
  "data": {
    "stepId": "login",
    "expected": "Login controls are visible",
    "actual": "Snapshot contains username, password, captcha, login button"
  }
}
```

Response:

```json
{
  "ok": true,
  "record": {
    "index": 1,
    "recordedAt": "2026-06-14T09:00:10.000Z",
    "type": "assertion",
    "status": "pass",
    "title": "Login page loaded"
  },
  "files": {
    "json": "reports/mcp-proxy/records.json",
    "jsonl": "reports/mcp-proxy/records.jsonl"
  }
}
```

For screenshots, store the exact same path used in `browser_take_screenshot.arguments.filename`. The monitor does not guess or rewrite paths.

Recommended `type` values:

- `observation`
- `assertion`
- `finding`
- `blocker`
- `coverage`

Recommended `status` values:

- `pass`
- `fail`
- `blocked`
- `skipped`
- `info`

## `GET /records`

Returns AI-authored records.

```json
{
  "ok": true,
  "outputDir": "reports/mcp-proxy",
  "records": []
}
```

Use this as the main structured input for Markdown/HTML reports.

## `GET /artifacts`

Lists files under `outputDir` recursively.

```json
{
  "ok": true,
  "outputDir": "reports/mcp-proxy",
  "files": [
    {
      "name": "01-login-page.png",
      "path": "reports/mcp-proxy/run-xxx/screenshots/01-login-page.png",
      "relativePath": "run-xxx/screenshots/01-login-page.png",
      "url": "/artifact?path=reports%2Fmcp-proxy%2Frun-xxx%2Fscreenshots%2F01-login-page.png",
      "size": 12345,
      "modifiedAt": "2026-06-14T09:00:00.000Z"
    }
  ]
}
```

## `GET /artifact`

Returns one artifact file for preview/download.

```text
GET /artifact?path=reports%2Fmcp-proxy%2Frun-xxx%2Fscreenshots%2F01-login-page.png
```

## `POST /reset`

Restarts the MCP/browser session and clears in-memory `/history`, `/records`, and `/run/state`.

```json
{
  "ok": true,
  "message": "session reset"
}
```

## Report Data Model

- `/run/state`: plan, progress, final run status
- `/history`: raw tool calls and MCP results
- `/records`: AI test conclusions
- `/artifacts`: screenshots and saved files under `outputDir`

## Responsibility Split

Proxy:

- starts MCP server
- calls MCP tools
- stores history
- stores records
- stores run state
- lists artifacts
- resets browser session

AI:

- decides what to test
- chooses tool calls
- interprets results
- writes `/record`
- updates `/run/state`
- generates final Markdown/HTML report

## Rules

- Use `browser_snapshot` after navigation and state changes.
- Prefer snapshot refs over CSS selectors.
- Take screenshots at important states.
- Use task-specific screenshot names; prefer subfolders for large flows.
- Store screenshot paths exactly as passed to `browser_take_screenshot`.
- Check console/network after failures.
- Call `/record` throughout the run, not only at the end.
- Call `/run/update` after each plan step.
- On resume, read `/run/state`, `/history`, `/records`, and `/artifacts` before continuing.
- Do not store passwords, tokens, cookies, or auth headers.
