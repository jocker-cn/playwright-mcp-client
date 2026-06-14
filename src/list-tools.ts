import { createPlaywrightMcpClient } from "./mcp-client.js";

const session = await createPlaywrightMcpClient({
  mcpArgs: ["--headless"]
});

try {
  const result = await session.client.listTools();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await session.close();
}
