import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callTool, createPlaywrightMcpClient, type ToolArguments } from "./mcp-client.js";

interface CallRequest {
  tool?: string;
  arguments?: ToolArguments;
}

interface RecordRequest {
  type?: string;
  status?: string;
  title?: string;
  url?: string;
  screenshot?: string;
  snapshotRef?: string;
  severity?: string;
  data?: unknown;
}

interface RunStep {
  id: string;
  title: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | "blocked" | "skipped";
  summary?: string;
  evidence?: unknown;
}

interface RunState {
  id: string;
  status: "idle" | "running" | "completed" | "failed" | "blocked";
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  target?: string;
  goal?: string;
  summary?: string;
  plan: RunStep[];
}

interface RunStartRequest {
  id?: string;
  target?: string;
  goal?: string;
  plan?: RunStep[];
}

interface RunUpdateRequest {
  status?: RunState["status"];
  stepId?: string;
  stepStatus?: RunStep["status"];
  summary?: string;
  evidence?: unknown;
  plan?: RunStep[];
}

const args = process.argv.slice(2);
const port = getNumberArg("--port", 8931);
const headed = args.includes("--headed");
const outputDir = getStringArg("--output-dir", "reports/mcp-proxy");
const viewport = getStringArg("--viewport-size", "1440x900");

await mkdir(outputDir, { recursive: true });

let session = await createSession();
const history: Array<Record<string, unknown>> = [];
const records: Array<Record<string, unknown>> = [];
let runState: RunState | null = null;

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, () => {
  console.log(JSON.stringify({
    ok: true,
    message: "MCP proxy server started",
    port,
    outputDir,
    headed,
    endpoints: [
      "GET /health",
      "GET /tools",
      "GET /history",
      "GET /records",
      "GET /run/state",
      "GET /artifacts",
      "POST /call",
      "POST /record",
      "POST /run/start",
      "POST /run/update",
      "POST /run/finish",
      "POST /reset"
    ]
  }, null, 2));
});

process.on("SIGINT", async () => {
  await session.close();
  server.close();
  process.exit(0);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      port,
      outputDir,
      headed,
      historyCount: history.length,
      recordCount: records.length,
      runStatus: runState?.status ?? "idle"
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/tools") {
    const result = await session.client.listTools();
    sendJson(response, 200, {
      ok: true,
      result
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/history") {
    sendJson(response, 200, {
      ok: true,
      history
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/records") {
    sendJson(response, 200, {
      ok: true,
      outputDir,
      records
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/run/state") {
    sendJson(response, 200, {
      ok: true,
      outputDir,
      run: runState
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/artifacts") {
    sendJson(response, 200, {
      ok: true,
      outputDir,
      files: await listArtifacts(outputDir)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/reset") {
    await session.close();
    session = await createSession();
    history.length = 0;
    records.length = 0;
    runState = null;
    await persistRecords();
    await persistRunState();
    sendJson(response, 200, {
      ok: true,
      message: "session reset"
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/run/start") {
    const body = await readJson<RunStartRequest>(request);
    const now = new Date().toISOString();
    runState = {
      id: body.id ?? `run-${now.replace(/[:.]/g, "-")}`,
      status: "running",
      startedAt: now,
      updatedAt: now,
      target: body.target,
      goal: body.goal,
      plan: (body.plan ?? []).map((step) => ({
        ...step,
        status: step.status ?? "pending"
      }))
    };
    await persistRunState();
    sendJson(response, 200, {
      ok: true,
      run: runState,
      file: `${outputDir}/run-state.json`
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/run/update") {
    if (!runState) {
      sendJson(response, 400, {
        ok: false,
        error: "No active run. Call POST /run/start first."
      });
      return;
    }

    const body = await readJson<RunUpdateRequest>(request);
    const now = new Date().toISOString();

    if (body.status) {
      runState.status = body.status;
    }

    if (body.summary !== undefined) {
      runState.summary = body.summary;
    }

    if (body.plan) {
      runState.plan = body.plan;
    }

    if (body.stepId) {
      const step = runState.plan.find((item) => item.id === body.stepId);
      if (!step) {
        sendJson(response, 404, {
          ok: false,
          error: `Run step not found: ${body.stepId}`
        });
        return;
      }

      if (body.stepStatus) {
        step.status = body.stepStatus;
      }
      if (body.summary !== undefined) {
        step.summary = body.summary;
      }
      if (body.evidence !== undefined) {
        step.evidence = redactSecrets(body.evidence);
      }
    }

    runState.updatedAt = now;
    await persistRunState();
    sendJson(response, 200, {
      ok: true,
      run: runState,
      file: `${outputDir}/run-state.json`
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/run/finish") {
    if (!runState) {
      sendJson(response, 400, {
        ok: false,
        error: "No active run. Call POST /run/start first."
      });
      return;
    }

    const body = await readJson<Pick<RunUpdateRequest, "status" | "summary">>(request);
    const now = new Date().toISOString();
    runState.status = body.status ?? "completed";
    runState.summary = body.summary ?? runState.summary;
    runState.updatedAt = now;
    runState.finishedAt = now;
    await persistRunState();
    sendJson(response, 200, {
      ok: true,
      run: runState,
      file: `${outputDir}/run-state.json`
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/record") {
    const body = await readJson<RecordRequest>(request);
    const entry = {
      index: records.length + 1,
      recordedAt: new Date().toISOString(),
      type: body.type ?? "observation",
      status: body.status ?? "info",
      title: body.title ?? "",
      url: body.url,
      screenshot: body.screenshot,
      snapshotRef: body.snapshotRef,
      severity: body.severity,
      data: redactSecrets(body.data ?? {})
    };
    records.push(entry);
    await appendFile(`${outputDir}/records.jsonl`, `${JSON.stringify(entry)}\n`, "utf8");
    await persistRecords();

    sendJson(response, 200, {
      ok: true,
      record: entry,
      files: {
        json: `${outputDir}/records.json`,
        jsonl: `${outputDir}/records.jsonl`
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/call") {
    const body = await readJson<CallRequest>(request);
    if (!body.tool) {
      sendJson(response, 400, {
        ok: false,
        error: "Missing required field: tool"
      });
      return;
    }

    const startedAt = new Date().toISOString();
    const result = await callTool(session.client, body.tool, body.arguments ?? {});
    const entry = {
      index: history.length + 1,
      startedAt,
      tool: body.tool,
      arguments: redactSecrets(body.arguments ?? {}),
      result
    };
    history.push(entry);

    sendJson(response, 200, {
      ok: true,
      ...entry
    });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: `No route for ${request.method} ${url.pathname}`
  });
}

async function persistRecords(): Promise<void> {
  await writeFile(`${outputDir}/records.json`, JSON.stringify({
    outputDir,
    records
  }, null, 2), "utf8");
}

async function persistRunState(): Promise<void> {
  await writeFile(`${outputDir}/run-state.json`, JSON.stringify({
    outputDir,
    run: runState
  }, null, 2), "utf8");
}

async function createSession() {
  const mcpArgs = [
    "--isolated",
    "--viewport-size",
    viewport,
    "--timeout-navigation",
    "120000",
    "--timeout-action",
    "15000",
    "--output-dir",
    outputDir
  ];

  if (!headed) {
    mcpArgs.unshift("--headless");
  }

  return createPlaywrightMcpClient({
    mcpArgs
  });
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) as T : {} as T;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  response.end(JSON.stringify(data, null, 2));
}

async function listArtifacts(directory: string): Promise<Array<Record<string, unknown>>> {
  const entries = await readdir(directory, {
    withFileTypes: true
  });
  const files: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const path = join(directory, entry.name);
    const info = await stat(path);
    files.push({
      name: entry.name,
      path,
      size: info.size,
      modifiedAt: info.mtime.toISOString()
    });
  }

  return files.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function getStringArg(name: string, defaultValue: string): string {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? defaultValue;
}

function getNumberArg(name: string, defaultValue: number): number {
  const value = Number(getStringArg(name, ""));
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = /password|token|secret|cookie|authorization/i.test(key) ? "***" : redactSecrets(item);
    }
    return output;
  }

  return value;
}
