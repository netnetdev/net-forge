export { AGENTS, ArgError, detectPackageManager, type Agent, PACKAGE_MANAGERS, parseArgs, runScript, shellArg, type CreateArgs, type PackageManager } from "./args.js";
export { findStarter, STARTERS, suggestStarter, type Starter, type StarterId } from "./catalog.js";
export { declarations, DOCS_URL, SOURCE_URL } from "./docs.js";
export { DEFAULT_DIR, DEFAULT_TEMPLATE, helpText, listTemplates, needsShell, nodeIo, runCreate, shellCommand, type Created, type CreateIo, type RunOptions } from "./main.js";
export { checkName, dependencies, MCP_PACKAGE, mcpConfig, vscodeMcpConfig, NameError, packageName, planProject, TYPESCRIPT_VERSION, type ProjectOptions } from "./project.js";
export { BASE_PACKAGES, selfVersion, starterFiles, versions, type StarterFiles, type Versions } from "./starters.js";
export { checkDirectory, checkTarget, FolderError, targetPath, writeProject } from "./write.js";
export { scaffold, unknownTemplate, type ScaffoldOptions, type ScaffoldResult } from "./scaffold.js";
