// Project inspection shared by `kit add`, `kit doctor` and the MCP server:
// file walking, framework detection, config read/write.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CONFIG_FILE, validateConfig, type KitProjectConfig } from "../config.js";

export type Framework = "plain-html" | "vite" | "react" | "phaser" | "three" | "bundler" | "godot" | "unity" | "emscripten";

/** Engines exported to a static page: wired through the host HTML. */
export const HTML_HOSTED: ReadonlySet<Framework> = new Set(["plain-html", "godot", "unity", "emscripten"]);

export interface Project {
  root: string;
  framework: Framework;
  /** package.json parsed, or null for a static page. */
  pkg: Record<string, unknown> | null;
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  /** The host page, relative to root. */
  html: string | null;
  /** The script entry for bundler projects, relative to root. */
  entry: string | null;
  typescript: boolean;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", ".git", ".next", ".turbo", ".vercel", "coverage", ".cache", ".vite"]);
export const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|html?|vue|svelte|astro|gd|cs|jslib)$/i;
const MAX_FILE_BYTES = 1_000_000;

/** Every source file under root, relative paths, skipping build output and minified bundles. */
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (SOURCE_EXT.test(name) && !/\.min\.[cm]?js$/i.test(name) && !/\.d\.ts$/.test(name) && st.size <= MAX_FILE_BYTES) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

export function readText(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

export function writeText(root: string, rel: string, text: string): void {
  writeFileSync(join(root, rel), text);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function deps(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  const all: Record<string, string> = {};
  for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
    const d = pkg[k];
    if (d && typeof d === "object") Object.assign(all, d as Record<string, string>);
  }
  return all;
}

export function hasKitDependency(pkg: Record<string, unknown> | null): boolean {
  return "@netnetcapital/kit" in deps(pkg);
}

/** The module script an index.html loads, resolved relative to root. */
function moduleEntryFromHtml(root: string, htmlRel: string): string | null {
  const html = readText(root, htmlRel);
  const re = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const re2 = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["']module["'][^>]*>/gi;
  for (const r of [re, re2]) {
    for (const m of html.matchAll(r)) {
      const src = m[1];
      if (!src || /^https?:/.test(src) || /netnet\.js$/.test(src)) continue;
      const rel = src.startsWith("/") ? src.slice(1) : join(dirname(htmlRel), src).split(sep).join("/");
      if (existsSync(join(root, rel))) return rel;
    }
  }
  return null;
}

const ENTRY_CANDIDATES = [
  "src/main.ts", "src/main.tsx", "src/main.js", "src/main.jsx",
  "src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx",
  "src/game.ts", "src/game.js", "main.ts", "main.js", "index.ts", "index.js", "game.js",
];

export function detectProject(rootIn: string, force?: Framework): Project {
  const root = resolve(rootIn);
  const pkg = readJson(join(root, "package.json"));
  const d = deps(pkg);
  const html = ["index.html", "public/index.html", "src/index.html"].find((h) => existsSync(join(root, h))) ?? null;
  const files = existsSync(root) ? readdirSync(root) : [];

  let framework: Framework;
  if (force) framework = force;
  else if (pkg) {
    if ("phaser" in d) framework = "phaser";
    else if ("three" in d) framework = "three";
    else if ("react" in d) framework = "react";
    else if ("vite" in d) framework = "vite";
    else framework = "bundler";
  } else if (files.some((f) => f.endsWith(".pck"))) framework = "godot";
  else if (existsSync(join(root, "Build")) && readdirSync(join(root, "Build")).some((f) => f.endsWith(".loader.js"))) framework = "unity";
  else if (files.some((f) => f.endsWith(".wasm"))) framework = "emscripten";
  else framework = "plain-html";

  const packageManager = existsSync(join(root, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(root, "yarn.lock"))
      ? "yarn"
      : existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))
        ? "bun"
        : "npm";

  let entry: string | null = null;
  if (!HTML_HOSTED.has(framework)) {
    entry = (html ? moduleEntryFromHtml(root, html) : null) ?? ENTRY_CANDIDATES.find((c) => existsSync(join(root, c))) ?? null;
  }
  const typescript = entry ? /\.tsx?$/.test(entry) : existsSync(join(root, "tsconfig.json"));
  return { root, framework, pkg, packageManager, html, entry, typescript };
}

export interface LoadedConfig {
  config: KitProjectConfig | null;
  problems: string[];
  exists: boolean;
  raw: unknown;
}

export function loadConfig(root: string): LoadedConfig {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { config: null, problems: [], exists: false, raw: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { config: null, problems: [`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`], exists: true, raw: null };
  }
  const { config, problems } = validateConfig(raw);
  return { config, problems, exists: true, raw };
}

export function saveConfig(root: string, config: KitProjectConfig): void {
  writeFileSync(join(root, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
}

/** 1-based line number of an index in text. */
export function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
