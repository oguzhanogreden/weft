import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";

const version = process.argv[2];
if (!version) throw new Error("version argument required");

const root = new URL("..", import.meta.url).pathname;

for (const name of readdirSync(resolve(root, "packages"))) {
  const pkgPath = resolve(root, "packages", name, "package.json");
  try {
    const json = JSON.parse(readFileSync(pkgPath, "utf8"));
    json.version = version;
    writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n");
    console.log(`  bumped ${json.name} → ${version}`);
  } catch {
    // skip directories without package.json
  }
}
