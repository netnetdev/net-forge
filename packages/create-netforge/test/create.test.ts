import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { ArgError, detectPackageManager, parseArgs, runScript, shellArg } from "../src/args.js";
import { findStarter, STARTERS, suggestStarter } from "../src/catalog.js";
import { declarations, DOCS_URL } from "../src/docs.js";
import { needsShell, runCreate, shellCommand, type CreateIo, type RunOptions } from "../src/main.js";
import { checkName, dependencies, NameError, packageName, planProject } from "../src/project.js";
import { scaffold } from "../src/scaffold.js";
import { starterFiles, versions } from "../src/starters.js";
import { checkDirectory, checkTarget, FolderError, targetPath } from "../src/write.js";

const tmp = () => mkdtempSync(join(tmpdir(), "create-netforge-"));

interface FakeIo extends CreateIo {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly runs: { cmd: string; args: readonly string[]; o: RunOptions }[];
}

function fakeIo(cwd: string, o: { interactive?: boolean; answers?: string[]; exit?: (cmd: string, args: readonly string[]) => number; agent?: string } = {}): FakeIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runs: FakeIo["runs"] = [];
  const answers = [...(o.answers ?? [])];
  return {
    stdout,
    stderr,
    runs,
    cwd,
    env: o.agent ? { npm_config_user_agent: o.agent } : {},
    interactive: o.interactive ?? false,
    out: (s) => stdout.push(s),
    err: (s) => stderr.push(s),
    async ask(q) {
      stdout.push(q);
      const a = answers.shift();
      if (a === undefined) throw new Error(`unexpected question: ${q}`);
      return a;
    },
    async run(cmd, args, ro) {
      runs.push({ cmd, args, o: ro });
      return o.exit ? o.exit(cmd, args) : cmd === "git" && args[0] === "rev-parse" ? 128 : 0;
    },
  };
}

describe("arguments", () => {
  it("reads a folder and every flag, in both --k v and --k=v forms", () => {
    const a = parseArgs(["my-game", "--template", "cards", "--yes", "--pm=pnpm", "--no-install", "--no-git", "--json"]);
    expect(a).toMatchObject({ dir: "my-game", template: "cards", yes: true, pm: "pnpm", install: false, git: false, json: true, list: false });
    expect(parseArgs(["-t", "racer", "-y"])).toMatchObject({ dir: null, template: "racer", yes: true, install: true, git: true });
    expect(parseArgs(["my-game", "--", "--template", "survivor", "--yes"])).toMatchObject({ dir: "my-game", template: "survivor", yes: true });
    expect(parseArgs(["--list", "--json"])).toMatchObject({ list: true, json: true });
    expect(parseArgs(["--dir", "g", "-t", "idle"])).toMatchObject({ dir: "g", template: "idle" });
    expect(() => parseArgs(["a", "--dir", "b"])).toThrow(/Give the folder once/);
  });

  it("refuses what it does not know, with a message that says what to do", () => {
    expect(() => parseArgs(["--tempalte", "x"])).toThrow(/Unknown option --tempalte/);
    expect(() => parseArgs(["--pm", "deno"])).toThrow(/--pm must be one of npm, pnpm, yarn, bun/);
    expect(() => parseArgs(["--template"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--template", "--yes"])).toThrow(/needs a value/);
    expect(() => parseArgs(["a", "b"])).toThrow(ArgError);
    expect(() => parseArgs(["--yes=1"])).toThrow(/takes no value/);
    expect(() => parseArgs(["-x"])).toThrow(/Unknown option -x/);
  });

  it("picks the agent files: all by default, a list, or none", () => {
    expect(parseArgs([]).agents).toEqual(["claude", "cursor", "copilot"]);
    expect(parseArgs(["--agent", "cursor"]).agents).toEqual(["cursor"]);
    expect(parseArgs(["--agent=claude,copilot"]).agents).toEqual(["claude", "copilot"]);
    expect(parseArgs(["--agent", "none"]).agents).toEqual([]);
    expect(() => parseArgs(["--agent", "vim"])).toThrow(/--agent must be/);
  });

  it("knows the package manager that ran it and how each runs a script", () => {
    expect(detectPackageManager("pnpm/10.33.2 npm/? node/v22.22.3 darwin arm64")).toBe("pnpm");
    expect(detectPackageManager("yarn/4.1.0 npm/? node/v22")).toBe("yarn");
    expect(detectPackageManager("bun/1.2.0")).toBe("bun");
    expect(detectPackageManager(undefined)).toBe("npm");
    expect(detectPackageManager("deno/2")).toBe("npm");
    expect(runScript("npm", "play")).toBe("npm run play");
    expect(runScript("pnpm", "play")).toBe("pnpm play");
    expect(runScript("bun", "play")).toBe("bun run play");
    expect(shellArg("my-game")).toBe("my-game");
    expect(shellArg("my game")).toBe('"my game"');
  });
});

describe("the templates", () => {
  it("are the ten Net Forge templates, each with a genre and a one-line description", () => {
    expect(STARTERS.map((t) => t.id).sort()).toEqual(["arena", "cards", "collector", "dungeon", "idle", "party", "platformer", "racer", "survivor", "tower-defense"]);
    for (const t of STARTERS) {
      expect(t.pkg).toBe(`@netforge/${t.dir}`);
      expect(t.genre.length).toBeGreaterThan(2);
      expect(t.line).toMatch(/^[A-Z].*\.$/);
      expect(t.line).not.toMatch(/\u2014/);
    }
  });

  it("are found by id, alias, title or package, and a typo gets a suggestion", () => {
    expect(findStarter("tower")?.id).toBe("tower-defense");
    expect(findStarter("TD")?.id).toBe("tower-defense");
    expect(findStarter("horde")?.id).toBe("survivor");
    expect(findStarter("INKWRIT")?.id).toBe("cards");
    expect(findStarter("@netforge/template-racer")?.id).toBe("racer");
    expect(findStarter("__proto__")).toBeNull();
    expect(findStarter("chess")).toBeNull();
    expect(suggestStarter("survivr")).toBe("survivor");
    expect(suggestStarter("plat")).toBe("platformer");
    expect(suggestStarter("zzzzzzzz")).toBeNull();
  });

  it("each has its game module and guide to copy, and a version for every package a game installs", () => {
    const v = versions();
    for (const t of STARTERS) {
      const f = starterFiles(t);
      expect(f.gameTs).toContain(`template: "${t.id === "tower-defense" ? "tower-defense" : t.id}"`);
      expect(f.llms.length).toBeGreaterThan(100);
      expect(declarations(f.gameTs)).toContain("game");
      expect(Object.keys(dependencies(t, v))).toEqual(["@netforge/engine", "@netforge/kit-play", t.pkg, "typescript"].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe("names", () => {
  it("turn a folder into a package name", () => {
    expect(packageName("My Game")).toBe("my-game");
    expect(packageName("  .Hidden__Thing!! ")).toBe("hidden__thing");
    expect(packageName("café")).toBe("caf");
    expect(packageName("!!!")).toBe("");
  });

  it("refuse a name that collides with a dependency or cannot install", () => {
    const deps = dependencies(STARTERS[0]!, versions());
    expect(() => checkName("typescript", deps)).toThrow(/depends on \(typescript\).*my-typescript/);
    expect(() => checkName("kit-play", deps)).toThrow(NameError);
    expect(() => checkName("template-survivor", deps)).toThrow(NameError);
    expect(() => checkName("create-netforge", deps)).toThrow(NameError);
    expect(() => checkName("node_modules", deps)).toThrow(/reserved/);
    expect(() => checkName("", deps)).toThrow(/no letters or digits/);
    expect(() => checkName("ok-name", deps)).not.toThrow();
  });
});

describe("the planned files", () => {
  const plan = (id: string, pm: "npm" | "pnpm" = "npm") => {
    const t = findStarter(id)!;
    return planProject({ name: "my-game", starter: t, files: starterFiles(t), versions: versions(), pm, creator: "0.0.0" });
  };

  it("are a complete project: package.json, netnet.json, the game, the guides", () => {
    const f = plan("survivor");
    expect([...f.keys()].sort()).toEqual([".cursor/mcp.json", ".cursor/rules/netforge.mdc", ".github/copilot-instructions.md", ".gitignore", ".mcp.json", ".vscode/mcp.json", "AGENTS.md", "CLAUDE.md", "README.md", "llms.txt", "netnet.json", "package.json", "src/game.ts", "tsconfig.json"]);
    const pkg = JSON.parse(f.get("package.json")!) as { name: string; private: boolean; scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.name).toBe("my-game");
    expect(pkg.private).toBe(true);
    expect(pkg.scripts).toEqual({ play: "kit-play play", test: "kit-play test", check: "kit-play check", typecheck: "tsc --noEmit" });
    expect(DOCS_URL).toBe("https://forge.netnet.capital/docs");
    expect(Object.keys(pkg.devDependencies)).toContain("@netforge/template-survivor");
    expect(Object.keys(pkg.devDependencies)).not.toContain("@netforge/kit");
    expect(JSON.parse(f.get("netnet.json")!)).toMatchObject({ template: "survivor" });
    expect(JSON.parse(f.get(".mcp.json")!)).toEqual({ mcpServers: { netforge: { command: "npx", args: ["-y", "@netforge/mcp"] } } });
    expect(JSON.parse(f.get(".vscode/mcp.json")!)).toEqual({ servers: { netforge: { type: "stdio", command: "npx", args: ["-y", "@netforge/mcp"] } } });
    expect(f.get("CLAUDE.md")).toContain("@AGENTS.md");
    expect(f.get(".cursor/rules/netforge.mdc")).toMatch(/^---\ndescription: .*\nglobs:\nalwaysApply: true\n---/);
    expect(f.get("src/game.ts")).toBe(starterFiles(findStarter("survivor")!).gameTs);
  });

  it("write the guides for this template and package manager, in plain sentences", () => {
    const f = plan("cards", "pnpm");
    const agents = f.get("AGENTS.md")!;
    expect(agents).toContain("`cards` template");
    expect(agents).toContain("pnpm test");
    expect(agents).toContain("`card`");
    expect(agents).toContain("node_modules/@netforge/template-cards/client/");
    expect(f.get("README.md")).toContain("pnpm play");
    expect(f.get("README.md")).toContain("https://forge.netnet.capital/docs");
    for (const doc of ["README.md", "AGENTS.md", ".cursor/rules/netforge.mdc"]) {
      expect(f.get(doc), doc).toContain("Net Forge, the open-source multiplayer browser game engine built for AI coding agents");
      expect(f.get(doc), doc).toContain("https://github.com/netnetdev/net-forge");
      // "NetForge" (one word) only in the line that says we are not those projects.
      expect(f.get(doc)!.replace("other projects named NetForge", ""), doc).not.toContain("NetForge");
    }
    for (const [path, body] of f) if (/\.(md|mdc)$/.test(path)) expect(body, path).not.toMatch(/\u2014/);
  });

  it("leave out the agent files nobody asked for", () => {
    const t = findStarter("idle")!;
    const f = planProject({ name: "g", starter: t, files: starterFiles(t), versions: versions(), pm: "npm", creator: "0", agents: [] });
    expect(f.has("AGENTS.md")).toBe(true);
    expect(f.has(".mcp.json")).toBe(true);
    expect(f.has("CLAUDE.md") || f.has(".cursor/rules/netforge.mdc") || f.has(".github/copilot-instructions.md")).toBe(false);
  });

  it("land under the project folder with the system's separators (Windows too)", () => {
    expect(targetPath("C:\\games\\my-game", "src/game.ts", win32)).toBe("C:\\games\\my-game\\src\\game.ts");
    expect(targetPath("C:\\games\\my-game", ".cursor/rules/netforge.mdc", win32)).toBe("C:\\games\\my-game\\.cursor\\rules\\netforge.mdc");
    expect(targetPath("/srv/my-game", "src/game.ts", posix)).toBe("/srv/my-game/src/game.ts");
    for (const bad of ["../x", "src/../../x", "/etc/passwd", "a\\b", "C:/x", "", "a//b"]) expect(() => targetPath("/srv/g", bad, posix), bad).toThrow(/bad planned path/);
    for (const rel of plan("survivor").keys()) expect(() => targetPath("C:\\g", rel, win32), rel).not.toThrow();
  });
});

describe("the target folder", () => {
  it("may be missing or empty (a fresh git repo counts as empty), never a file or a folder with files", () => {
    const d = tmp();
    expect(() => checkTarget(join(d, "new"), "new")).not.toThrow();
    mkdirSync(join(d, "empty", ".git"), { recursive: true });
    expect(() => checkTarget(join(d, "empty"), "empty")).not.toThrow();
    writeFileSync(join(d, "file"), "x");
    expect(() => checkTarget(join(d, "file"), "file")).toThrow(/is a file/);
    mkdirSync(join(d, "full"));
    writeFileSync(join(d, "full", "notes.txt"), "x");
    expect(() => checkTarget(join(d, "full"), "full")).toThrow(FolderError);
    expect(() => checkTarget(join(d, "full"), "full")).toThrow(/not empty \(notes.txt\)/);
  });

  it("is never a literal ~ (no shell expanded it) or a name with a control character", () => {
    for (const bad of ["~", "~/games/x", "/opt/me/~/x", "C:\\work\\~\\x", "~\\games\\x", "nl\nx", "tab\tx", "bell\u0007", "del\u007f"]) expect(() => checkDirectory(bad), JSON.stringify(bad)).toThrow(FolderError);
    for (const ok of ["my-game", "../games/x", "/srv/games/x", "C:\\games\\x", "a~b", "Gear Works", "游戏"]) expect(() => checkDirectory(ok), ok).not.toThrow();
  });
});

describe("create-netforge, headless", () => {
  it("makes a game with no questions, then runs git and the install in the new folder", async () => {
    const d = tmp();
    const io = fakeIo(d, { agent: "pnpm/10.33.2 npm/? node/v22" });
    expect(await runCreate(["my-game", "--template", "racer"], io)).toBe(0);
    const dir = join(d, "my-game");
    expect(JSON.parse(readFileSync(join(dir, "netnet.json"), "utf8")).template).toBe("racer");
    expect(existsSync(join(dir, "src", "game.ts"))).toBe(true);
    expect(io.runs.map((r) => [r.cmd, ...r.args].join(" "))).toEqual(["git rev-parse --is-inside-work-tree", "git init -q", "git add -A", "git commit -q -m Start a Net Forge game", "pnpm install"]);
    expect(io.runs.every((r) => r.o.cwd === dir)).toBe(true);
    const out = io.stdout.join("\n");
    expect(out).toContain("  cd my-game\n  pnpm play");
    expect(out).toContain("https://forge.netnet.capital/docs");
    expect(io.stderr).toEqual([]);
  });

  it("takes the template npm kept when the -- was left out (npm_config_template)", async () => {
    const d = tmp();
    const io = { ...fakeIo(d), env: { npm_config_template: "racer" } };
    expect(await runCreate(["g", "--no-install", "--no-git"], io)).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "g", "netnet.json"), "utf8")).template).toBe("racer");
  });

  it("defaults the folder and the template with no terminal, and says so", async () => {
    const d = tmp();
    const io = fakeIo(d);
    expect(await runCreate(["--no-install", "--no-git"], io)).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "my-game", "netnet.json"), "utf8")).template).toBe("survivor");
    expect(io.stdout.join("\n")).toMatch(/No --template given: using survivor/);
    expect(io.stdout.join("\n")).toContain("  cd my-game\n  npm install\n  npm run play");
    expect(io.runs).toEqual([]);
  });

  it("prints a JSON summary on stdout with --json and keeps the logs on stderr", async () => {
    const d = tmp();
    const io = fakeIo(d);
    expect(await runCreate(["g", "-t", "idle", "--json", "--no-git", "--pm", "bun"], io)).toBe(0);
    expect(io.stdout).toHaveLength(1);
    const s = JSON.parse(io.stdout[0]!) as { template: string; pm: string; installed: boolean; next: string[]; files: string[] };
    expect(s).toMatchObject({ template: "idle", pm: "bun", installed: true, next: ["cd g", "bun run play"] });
    expect(s.files).toContain("src/game.ts");
    expect(io.runs[0]?.o.toStdout).toBe(false);
  });

  it("stops with an actionable message on a bad template, a used folder or a clashing name", async () => {
    const d = tmp();
    let io = fakeIo(d);
    expect(await runCreate(["g", "--template", "survivr"], io)).toBe(2);
    expect(io.stderr.join("\n")).toMatch(/no template called "survivr". Did you mean survivor\? The templates are: survivor, arena/);
    mkdirSync(join(d, "taken"));
    writeFileSync(join(d, "taken", "index.html"), "x");
    io = fakeIo(d);
    expect(await runCreate(["taken", "--yes"], io)).toBe(2);
    expect(io.stderr.join("\n")).toMatch(/The folder taken is not empty/);
    expect(readFileSync(join(d, "taken", "index.html"), "utf8")).toBe("x");
    io = fakeIo(d);
    expect(await runCreate(["vitest-x", "--yes", "--no-install"], io)).toBe(0);
    io = fakeIo(d);
    expect(await runCreate(["typescript", "--yes"], io)).toBe(2);
    expect(io.stderr.join("\n")).toMatch(/Pick another name, such as my-typescript/);
    expect(existsSync(join(d, "typescript"))).toBe(false);
    io = fakeIo(d);
    expect(await runCreate(["--bogus"], io)).toBe(2);
  });

  it("reports a failed install with the command to retry, and exits 1", async () => {
    const d = tmp();
    const io = fakeIo(d, { exit: (cmd, args) => (cmd === "npm" ? 1 : args[0] === "rev-parse" ? 128 : 0) });
    expect(await runCreate(["g", "-y"], io)).toBe(1);
    expect(io.stderr.join("\n")).toMatch(/npm install failed \(exit 1\).*cd g && npm install/);
  });

  it("makes no repository inside an existing one", async () => {
    const d = tmp();
    const io = fakeIo(d, { exit: () => 0 });
    expect(await runCreate(["g", "-y", "--no-install"], io)).toBe(0);
    expect(io.runs.map((r) => r.args[0])).toEqual(["rev-parse"]);
  });

  it("lists the templates, for people and as JSON", async () => {
    const io = fakeIo(tmp());
    expect(await runCreate(["--list", "--json"], io)).toBe(0);
    const list = JSON.parse(io.stdout[0]!) as { id: string; genre: string; players: number; package: string; description: string }[];
    expect(list).toHaveLength(10);
    expect(list[0]).toMatchObject({ id: "survivor", genre: "survivor-like co-op", players: 4, package: "@netforge/template-survivor" });
    const people = fakeIo(tmp());
    await runCreate(["--list"], people);
    expect(people.stdout[0]).toMatch(/^ {2}survivor +survivor-like co-op/m);
  });
});

describe("create-netforge, in a terminal", () => {
  it("asks for the template (a number or a name) and the folder, and asks again after a bad answer", async () => {
    const d = tmp();
    mkdirSync(join(d, "full"));
    writeFileSync(join(d, "full", "x"), "x");
    const io = fakeIo(d, { interactive: true, answers: ["99", "cards", "full", "duel-game"] });
    expect(await runCreate(["--no-install", "--no-git"], io)).toBe(0);
    const out = io.stdout.join("\n");
    expect(out).toMatch(/Which template\?\n {3}1 {2}survivor +survivor-like co-op: /);
    expect(out).toContain('There is no template called "99"');
    expect(out).toContain("The folder full is not empty");
    expect(JSON.parse(readFileSync(join(d, "duel-game", "netnet.json"), "utf8")).template).toBe("cards");
  });

  it("asks nothing with --yes, and takes Enter as the default", async () => {
    const d = tmp();
    expect(await runCreate(["-y", "--no-install", "--no-git"], fakeIo(d, { interactive: true }))).toBe(0);
    const io = fakeIo(d, { interactive: true, answers: ["", "second"] });
    expect(await runCreate(["--no-install", "--no-git"], io)).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "second", "netnet.json"), "utf8")).template).toBe("survivor");
  });
});

describe("scaffold(), the library entry", () => {
  it("makes a game from { template, directory, name } with no install, and returns the files and next commands", async () => {
    const d = tmp();
    const r = await scaffold({ template: "tower", directory: join(d, "Gear Works"), name: "gear-works" });
    expect(r).toMatchObject({ directory: join(d, "Gear Works"), name: "gear-works", template: "tower-defense" });
    expect(r.files).toContain("src/game.ts");
    expect(r.files).toContain(".vscode/mcp.json");
    expect(r.next).toEqual([`cd "${join(d, "Gear Works")}"`, "npm install", "npm run play"]);
    expect(JSON.parse(readFileSync(join(d, "Gear Works", "package.json"), "utf8")).name).toBe("gear-works");
    for (const f of r.files) expect(existsSync(join(d, "Gear Works", ...f.split("/"))), f).toBe(true);
  });

  it("resolves a relative directory against the caller's cwd", async () => {
    const d = tmp();
    const r = await scaffold({ template: "party", directory: "rel-game", cwd: d });
    expect(r.directory).toBe(join(d, "rel-game"));
    expect(existsSync(join(d, "rel-game", "netnet.json"))).toBe(true);
  });

  it("throws the same actionable errors as the CLI", async () => {
    const d = tmp();
    await expect(scaffold({ template: "chess", directory: join(d, "a") })).rejects.toThrow(/no template called "chess"/);
    await expect(scaffold({ template: "cards", directory: join(d, "b"), name: "vite" })).resolves.toMatchObject({ name: "vite" });
    await expect(scaffold({ template: "cards", directory: join(d, "b") })).rejects.toThrow(FolderError);
    await expect(scaffold({ template: "cards", directory: join(d, "c"), name: "typescript" })).rejects.toThrow(NameError);
    await expect(scaffold({ template: "cards", directory: "~/x", cwd: d })).rejects.toThrow(/a ~ folder/);
    await expect(scaffold({ template: "cards", directory: join(d, "~", "x") })).rejects.toThrow(/a ~ folder/);
    await expect(scaffold({ template: "cards", directory: "a\nb", cwd: d })).rejects.toThrow(/control character/);
    expect(readdirSync(d).sort()).toEqual(["b"]);
  });
});

describe("child processes", () => {
  it("go through a shell only on Windows, never for git, and only with fixed words", () => {
    expect(needsShell("npm", "darwin")).toBe(false);
    expect(needsShell("pnpm", "linux")).toBe(false);
    expect(needsShell("pnpm", "win32")).toBe(true);
    expect(needsShell("git", "win32")).toBe(false);
    expect(shellCommand("pnpm", ["install"])).toBe("pnpm install");
    for (const w of ["npm; rm -rf ~", "a b", "$(x)", "a&b", "a|b", "%PATH%", "\"q\""]) expect(() => shellCommand("npm", [w]), w).toThrow(/refusing/);
  });

  it("refuse a --pm that is not a package manager", () => {
    expect(() => parseArgs(["x", "--pm", "npm; rm -rf ~"])).toThrow(ArgError);
    expect(() => parseArgs(["x", "--pm=npm&&calc"])).toThrow(ArgError);
  });
});
