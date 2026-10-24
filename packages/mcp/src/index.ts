/**
 * @netforge/mcp: the Net Forge MCP server and the functions behind its tools.
 * Start it with `npx -y @netforge/mcp` (stdio), or embed it with
 * createNetForgeMcpServer() and any MCP transport.
 */
export { createNetForgeMcpServer, startStdioServer } from "./mcp.js";
export { listTemplates, type TemplateInfo } from "./catalog.js";
export { createGame, ScaffoldError, type CreateGameInput, type CreateGameResult } from "./scaffold.js";
export { searchDocs, findDeclarations, sections, type DocSection, type DocHit, type Declaration } from "./docs.js";
export { gameSource, runGame, dispose, SourceError, type GameError, type GameSource, type GameSummary, type RunResult, type RunOptions } from "./sandbox.js";
export { playLocally, stopAllSessions, type PlayResult } from "./play.js";
export { MCP_VERSION } from "./version.js";
