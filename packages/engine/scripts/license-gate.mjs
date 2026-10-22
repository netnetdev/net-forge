// prepublishOnly guard for the Net Forge engine packages: refuses to publish
// while the package's LICENSE still says the license is pending, so a
// package whose LICENSE file and "license" field have not been set to the
// chosen license cannot reach npm.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.cwd();
const license = join(dir, "LICENSE");
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
if (!existsSync(license) || readFileSync(license, "utf8").includes("LICENSE PENDING")) {
  console.error(`${pkg.name}: the license is not chosen yet (LICENSE says LICENSE PENDING). Pick it, replace LICENSE and the "license" field, then publish.`);
  process.exit(1);
}
