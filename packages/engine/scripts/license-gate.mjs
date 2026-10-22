// prepublishOnly guard for the Net Forge engine packages: refuses to publish
// while the package's LICENSE still says the license is pending. The human
// picks the license (Q155, 2026-10-21) and replaces every LICENSE file and
// "license" field; until then `npm publish` / `pnpm publish` stop here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.cwd();
const license = join(dir, "LICENSE");
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
if (!existsSync(license) || readFileSync(license, "utf8").includes("LICENSE PENDING")) {
  console.error(`${pkg.name}: the license is not chosen yet (LICENSE says LICENSE PENDING). Pick it, replace LICENSE and the "license" field, then publish.`);
  process.exit(1);
}
