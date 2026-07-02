import { execSync } from "node:child_process";

/**
 * Latest release tag reachable from HEAD (semantic-release `v${version}` format),
 * used to stamp the docs top-bar version badge at build time. Falls back to
 * "v0.0.0" when git/tags are unavailable (e.g. shallow CI clone, tarball build).
 */
export function latestReleaseTag(): string {
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim();
  } catch {
    return "v0.0.0";
  }
}
