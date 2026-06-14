import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type ToolArguments = Record<string, unknown>;

export interface PlaywrightMcpClientOptions {
  mcpArgs?: string[];
}

function getPnpmCommand(): string {
  if (process.env.PNPM_PATH) {
    return process.env.PNPM_PATH;
  }

  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export async function createPlaywrightMcpClient(options: PlaywrightMcpClientOptions = {}) {
  const mcpArgs = options.mcpArgs ?? [];
  const transport = new StdioClientTransport({
    command: getPnpmCommand(),
    args: ["exec", "playwright-mcp", ...mcpArgs]
  });

  const client = new Client({
    name: "playwright-mcp-demo-proxy",
    version: "0.1.0"
  });

  await client.connect(transport);

  return {
    client,
    async close() {
      await client.close();
    }
  };
}

export async function callTool(client: Client, tool: string, args: ToolArguments = {}) {
  return client.callTool({
    name: tool,
    arguments: args
  });
}
