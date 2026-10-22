#!/usr/bin/env node
// kit-mcp: the Kit's MCP server on stdio. Same as `npx @netnetcapital/kit mcp`.
import { startStdioServer } from "./server.js";

startStdioServer().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
