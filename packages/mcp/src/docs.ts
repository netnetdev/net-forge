// The bundled Net Forge docs (README.md, llms.txt, llms-full.txt,
// GAME-DESIGN.md, AGENTS.md of every package), split into sections at their
// headings and searched by term overlap. explain_api adds the typed
// declarations from the installed engine's .d.ts files.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { packageRoot } from "./locate.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface DocSection {
  readonly package: string;
  readonly file: string;
  readonly heading: string;
  readonly text: string;
}

interface DocFile {
  readonly package: string;
  readonly file: string;
  readonly text: string;
}

const FILES = ["README.md", "llms.txt", "llms-full.txt", "GAME-DESIGN.md", "AGENTS.md"];

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** dist/docs (the build copies them there), else the sibling package folders (running from source). */
function loadFiles(): DocFile[] {
  const bundled = join(here, "docs");
  const index = readJson<Array<{ package: string; dir: string; file: string }>>(join(bundled, "index.json"));
  if (index) return index.map((e) => ({ package: e.package, file: `${e.dir}/${e.file}`, text: readFileSync(join(bundled, e.dir, e.file), "utf8") }));
  const packages = join(here, "..", "..");
  const out: DocFile[] = [];
  for (const dir of readdirSync(packages).sort()) {
    const pkg = readJson<{ name: string; private?: boolean }>(join(packages, dir, "package.json"));
    if (!pkg || pkg.private || !pkg.name.startsWith("@netforge/")) continue;
    for (const f of FILES) if (existsSync(join(packages, dir, f))) out.push({ package: pkg.name, file: `${dir}/${f}`, text: readFileSync(join(packages, dir, f), "utf8") });
  }
  return out;
}

function split(f: DocFile): DocSection[] {
  const out: DocSection[] = [];
  let heading = f.file;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ package: f.package, file: f.file, heading, text });
    buf = [];
  };
  let fence = false;
  for (const line of f.text.split("\n")) {
    if (/^```/.test(line)) fence = !fence;
    const m = fence ? null : /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2]?.trim() ?? heading;
    }
    buf.push(line);
  }
  flush();
  return out;
}

let cache: DocSection[] | null = null;

/** Every section, with duplicates (llms.txt repeated inside llms-full.txt) dropped. */
export function sections(): DocSection[] {
  if (cache) return cache;
  const seen = new Set<string>();
  const out: DocSection[] = [];
  for (const f of loadFiles()) {
    for (const s of split(f)) {
      const key = s.text.replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  cache = out;
  return out;
}

export function docPackages(): string[] {
  return [...new Set(sections().map((s) => s.package))].sort();
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "it", "how", "do", "i", "my", "with", "what", "does", "can", "game"]);

function terms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_.@/-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface DocHit extends DocSection {
  readonly score: number;
}

/** Sections ranked by how many query terms they hold, headings weighted. */
export function searchDocs(query: string, opts: { package?: string | undefined; limit?: number | undefined; maxChars?: number | undefined } = {}): DocHit[] {
  const ts = terms(query);
  if (ts.length === 0) return [];
  const limit = opts.limit ?? 5;
  const maxChars = opts.maxChars ?? 2400;
  const hits: DocHit[] = [];
  for (const s of sections()) {
    if (opts.package && s.package !== opts.package && !s.package.endsWith(`/${opts.package}`)) continue;
    const body = s.text.toLowerCase();
    const head = s.heading.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of ts) {
      let n = 0;
      for (let i = body.indexOf(t); i >= 0 && n < 20; i = body.indexOf(t, i + t.length)) n++;
      if (n > 0) matched++;
      score += Math.log2(1 + n) + (head.includes(t) ? 3 : 0);
    }
    if (matched === 0) continue;
    score *= matched / ts.length;
    if (s.file.endsWith("llms-full.txt") || s.file.endsWith("llms.txt")) score *= 1.15;
    hits.push({ ...s, text: s.text.length > maxChars ? `${s.text.slice(0, maxChars)}\n[...]` : s.text, score: Math.round(score * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface Declaration {
  /** The import path that exposes it, e.g. @netforge/engine or @netforge/engine-sim. */
  readonly module: string;
  /** The .d.ts file it was read from, relative to the package. */
  readonly file: string;
  readonly kind: string;
  /** The declaration as written in the typings (signature or interface body, cut at 60 lines). */
  readonly signature: string;
  /** Its doc comment, if any. */
  readonly doc: string | null;
}

function dtsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) dtsFiles(p, out);
    else if (e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const dtsCache = new Map<string, Array<{ file: string; text: string }>>();

function typings(pkg: string): Array<{ file: string; text: string }> {
  const hit = dtsCache.get(pkg);
  if (hit) return hit;
  const root = packageRoot(pkg);
  const files = root ? dtsFiles(join(root, "dist")).map((f) => ({ file: relative(root, f), text: readFileSync(f, "utf8") })) : [];
  dtsCache.set(pkg, files);
  return files;
}

/** Which public entry exposes a dist file (dist/runtime/... is @netforge/engine/runtime, and so on). */
function moduleFor(pkg: string, file: string): string {
  if (pkg !== "@netforge/engine") return pkg;
  const sub = /^dist\/(runtime|net|game|rules)\//.exec(file)?.[1];
  return sub ? `${pkg}/${sub}` : pkg;
}

/** The typed declarations named `name` in the engine and the sim (for "earn.rule", the declaration of "earn"). */
export function findDeclarations(name: string, limit = 4): Declaration[] {
  const base = name.split(".")[0] ?? name;
  if (!/^[A-Za-z_$][\w$]*$/.test(base)) return [];
  const re = new RegExp(`(\\/\\*\\*(?:(?!\\*\\/)[\\s\\S])*\\*\\/\\s*)?export (?:declare )?(function|const|class|interface|type|enum) ${base.replace(/\$/g, "\\$")}\\b`, "g");
  const out: Declaration[] = [];
  for (const pkg of ["@netforge/engine", "@netforge/engine-sim"]) {
    for (const f of typings(pkg)) {
      for (const m of f.text.matchAll(re)) {
        const start = (m.index ?? 0) + (m[1]?.length ?? 0);
        const rest = f.text.slice(start).split("\n");
        const lines: string[] = [];
        let depth = 0;
        for (const l of rest) {
          lines.push(l);
          depth += (l.match(/[{(]/g) ?? []).length - (l.match(/[})]/g) ?? []).length;
          if (depth <= 0 && /[;}]\s*$/.test(l)) break;
          if (lines.length >= 60) {
            lines.push("    ...");
            break;
          }
        }
        const doc = m[1] ? m[1].replace(/^\s*\/\*\*|\*\/\s*$/g, "").split("\n").map((l) => l.replace(/^\s*\* ?/, "")).join("\n").trim() : null;
        out.push({ module: moduleFor(pkg, f.file), file: f.file, kind: m[2] ?? "", signature: lines.join("\n"), doc });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
