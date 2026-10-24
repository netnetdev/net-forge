#!/usr/bin/env node
// netforge-mcp: the Net Forge MCP server on stdio.
import { startStdioServer } from "./mcp.js";

startStdioServer().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
