import { callTool, createPlaywrightMcpClient, type ToolArguments } from "./mcp-client.js";

const [, , tool, rawArguments = "{}"] = process.argv;

if (!tool) {
  console.error("Usage: tsx src/call-tool.ts <tool-name> '<json-arguments>'");
  process.exit(1);
}

let toolArguments: ToolArguments;
try {
  toolArguments = JSON.parse(rawArguments);
} catch (error) {
  console.error(`Invalid JSON arguments: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const session = await createPlaywrightMcpClient({
  mcpArgs: ["--headless"]
});

try {
  const result = await callTool(session.client, tool, toolArguments);
  console.log(JSON.stringify({
    ok: true,
    tool,
    result
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    tool,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
} finally {
  await session.close();
}
